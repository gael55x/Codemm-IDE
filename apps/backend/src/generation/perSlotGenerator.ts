import crypto from "crypto";
import { createCodemmCompletion } from "../infra/llm";
import { tryParseJson } from "../utils/jsonParser";
import { buildDefaultClassSkeleton, inferClassName } from "../utils/javaCodegen";
import {
  hasBrittleWhitespaceStringExpectations,
  isValidJUnit5TestSuite,
} from "../languages/java/rules";
import { diagnoseCppTestSuite, hasCppStdoutWrites, looksLikeCppTestSuiteCapturesStdout } from "../languages/cpp/rules";
import { hasPythonStdoutWrites, isValidPytestTestSuiteForStyle } from "../languages/python/rules";
import { GeneratedProblemDraftSchema, type GeneratedProblemDraft } from "../contracts/problem";
import type { ProblemSlot } from "../planner/types";
import { buildSlotPromptWithContext, getSystemPromptForSlot } from "./prompts";
import { trace, traceText } from "../utils/trace";
import { GenerationContractError } from "./errors";
import { getTopLevelPublicTypeNames } from "../utils/javaSource";
import type { SlotPromptContext } from "../languages/types";
import { coerceSqlTestSuiteToJsonString } from "../languages/sql/rules";

const CODEX_MODEL = process.env.CODEX_MODEL;
const MAX_TOKENS = 5000;
const TEMPERATURE = 0.3;

type ProblemStyle = "stdout" | "return" | "mixed";
function normalizeProblemStyle(raw: string): ProblemStyle {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "stdout" || s === "return" || s === "mixed") return s;
  if (s.includes("stdout")) return "stdout";
  if (s.includes("mixed")) return "mixed";
  return "return";
}

function stripCppComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock.replace(/\/\/.*$/gm, "");
}

function extractCppSolveSignature(referenceSolution: string): string | null {
  const src = String(referenceSolution ?? "");
  if (!src.trim()) return null;

  // Best-effort: match a solve(...) function definition (brace may be on same line).
  const reSameLine =
    /(^|\n)\s*([A-Za-z_][\w:<>\s*&]+?)\s+solve\s*\(([\s\S]*?)\)\s*(?:const\s*)?\{/m;
  const m1 = reSameLine.exec(src);
  const m = m1;
  if (!m) return null;

  const returnType = m[2]?.replace(/\s+/g, " ").trim();
  const params = m[3]?.replace(/\s+/g, " ").trim();
  if (!returnType || params == null) return null;
  return `${returnType} solve(${params})`;
}

function synthesizeCppStarterCodeFromReference(args: { referenceSolution: string; fallbackTopic: string }): string | null {
  const signature = extractCppSolveSignature(args.referenceSolution);
  if (!signature) return null;

  return `#include <bits/stdc++.h>

${signature} {
  // BEGIN STUDENT TODO
  // TODO: Implement the missing core logic (${args.fallbackTopic}).
  // Hint: Use the problem description as your spec.
  // Hint: Let the tests drive edge cases.
  // END STUDENT TODO
  throw std::runtime_error("TODO");
}
`;
}

export const __test__ = {
  stripCppComments,
  extractCppSolveSignature,
  synthesizeCppStarterCodeFromReference,
};

export type RepairContext = {
  previousDraft?: GeneratedProblemDraft;
  previousRaw?: string;
  errorMessage?: string;
  judgeStdout?: string;
  judgeStderr?: string;
};

export type GeneratedDraftWithMeta = {
  draft: GeneratedProblemDraft;
  meta: { llmOutputHash: string };
};

async function repairCppTestSuite(args: {
  slot: ProblemSlot;
  title: string;
  description: string;
  constraints: string;
  starterCode: string;
  referenceSolution: string;
  previousTestSuite: string;
  errorMessage: string;
}): Promise<string> {
  const style = normalizeProblemStyle(args.slot.problem_style);
  const system = `
You are Codemm's C++ test suite repairer.

Your job:
- Produce a VALID C++20 test.cpp for a problem, using the required harness.
- The test suite MUST compile against solution.cpp and MUST be deterministic.

Hard rules:
- Return ONLY valid JSON (no markdown, no code fences, no prose)
- Output schema: { "test_suite": "..." }
- test_suite must be based on this exact template (copy/paste; only edit inside the TODO blocks):
  #include <bits/stdc++.h>
  #include "solution.cpp"

  static int __codem_failures = 0;
  #define RUN_TEST(name, ...) do { \\
    try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\\\n"; } \\
    catch (const std::exception&) { std::cout << "[FAIL] " << (name) << "\\\\n"; __codem_failures++; } \\
    catch (...) { std::cout << "[FAIL] " << (name) << "\\\\n"; __codem_failures++; } \\
  } while (0)

  int main() {
    RUN_TEST("test_case_1", { /* TODO */ });
    RUN_TEST("test_case_2", { /* TODO */ });
    RUN_TEST("test_case_3", { /* TODO */ });
    RUN_TEST("test_case_4", { /* TODO */ });
    RUN_TEST("test_case_5", { /* TODO */ });
    RUN_TEST("test_case_6", { /* TODO */ });
    RUN_TEST("test_case_7", { /* TODO */ });
    RUN_TEST("test_case_8", { /* TODO */ });
    return __codem_failures ? 1 : 0;
  }

Additional rules:
- Each TODO block must contain deterministic assertions (use std::runtime_error on failure).
- Problem style for this activity is "${style}":
  - return: tests should call solve(...) and compare returned values.
  - stdout: tests should call solve(...), capture std::cout output (redirect rdbuf), and compare printed output.
  - mixed: tests should compare BOTH the returned value and captured std::cout output.
`.trim();

  const user = `
Slot:
${JSON.stringify({ difficulty: args.slot.difficulty, topics: args.slot.topics, style: args.slot.problem_style })}

Title:
${args.title}

Description:
${args.description}

Constraints:
${args.constraints}

Starter code (learner edits):
${args.starterCode}

Reference solution (must pass all tests):
${args.referenceSolution}

Previous invalid test_suite:
${args.previousTestSuite}

Error:
${args.errorMessage}

Return JSON: {"test_suite":"..."} only.
`.trim();

  const completion = await createCodemmCompletion({
    system,
    user,
    ...(CODEX_MODEL ? { model: CODEX_MODEL } : {}),
    temperature: 0.2,
    maxTokens: 2400,
  });

  const text = completion.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  traceText("generation.cpp.testSuite.repair.raw", text, { extra: { slotIndex: args.slot.index } });
  const parsed = tryParseJson(text) as any;
  const repaired = typeof parsed?.test_suite === "string" ? parsed.test_suite.trim() : "";
  if (!repaired) throw new Error("C++ test_suite repair failed: missing test_suite.");
  return repaired;
}

async function repairPythonTestSuite(args: {
  slot: ProblemSlot;
  title: string;
  description: string;
  constraints: string;
  starterCode: string;
  referenceSolution: string;
  previousTestSuite: string;
  errorMessage: string;
}): Promise<string> {
  const style = normalizeProblemStyle(args.slot.problem_style);
  const system = `
You are Codemm's Python pytest test suite repairer.

Your job:
- Produce a VALID pytest test suite for the given problem.
- The suite MUST be deterministic and MUST pass against the provided reference_solution.

Hard rules:
- Return ONLY valid JSON (no markdown, no code fences, no prose)
- Output schema: { "test_suite": "..." }
- Python 3.11, pytest
- test_suite MUST start with:
  import pytest
  from solution import solve
- Exactly 8 tests named: test_case_1 ... test_case_8
- Tests MUST NOT use input(), print(), open(), randomness, or pytest.approx

Problem style for this activity is "${style}":
- return: each test must assert solve(...) == expected
- stdout: each test must call solve(...), then use capsys.readouterr() and assert on captured.out
- mixed: each test must assert solve(...) == expected AND assert captured.out (after calling solve)
`.trim();

  const user = `
Slot:
${JSON.stringify({ difficulty: args.slot.difficulty, topics: args.slot.topics, style: args.slot.problem_style })}

Title:
${args.title}

Description:
${args.description}

Constraints:
${args.constraints}

Starter code (learner edits):
${args.starterCode}

Reference solution (must pass all tests):
${args.referenceSolution}

Previous invalid test_suite:
${args.previousTestSuite}

Error:
${args.errorMessage}

Return JSON: {"test_suite":"..."} only.
`.trim();

  const completion = await createCodemmCompletion({
    system,
    user,
    ...(CODEX_MODEL ? { model: CODEX_MODEL } : {}),
    temperature: 0,
    maxTokens: 2000,
  });

  const text = completion.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  traceText("generation.python.testSuite.repair.raw", text, { extra: { slotIndex: args.slot.index } });
  const parsed = tryParseJson(text) as any;
  const repaired = typeof parsed?.test_suite === "string" ? parsed.test_suite.trim() : "";
  if (!repaired) throw new Error("Python test_suite repair failed: missing test_suite.");
  return repaired;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function inferPrimaryClassName(starterCode: string, fallback: string): string {
  const topLevelPublic = getTopLevelPublicTypeNames(starterCode)[0];
  if (topLevelPublic) return topLevelPublic;
  return inferClassName(starterCode, fallback);
}

function assertJavaFilenameMatchesPublicClass(filename: string, source: string) {
  const publicType = getTopLevelPublicTypeNames(source)[0];
  if (!publicType) return; // no public top-level type is okay
  const expected = filename.replace(/\.java$/i, "");
  if (publicType !== expected) {
    throw new Error(`Public type "${publicType}" must match filename "${filename}".`);
  }
}

function getWorkspaceTargetFile(draft: any): { path: string; role: string; content: string } | null {
  const files = draft?.workspace?.files;
  if (!Array.isArray(files) || files.length === 0) return null;
  const nonEntry = files.find((f: any) => f && typeof f === "object" && f.role !== "entry");
  return (nonEntry ?? files[0]) as any;
}

function buildJavaRepairPrompt(slot: ProblemSlot, repair: RepairContext, ctx?: SlotPromptContext): string {
  const previousJson =
    repair.previousDraft != null ? JSON.stringify(repair.previousDraft, null, 2) : null;
  const stdoutSnippet = (repair.judgeStdout ?? "").slice(0, 1600);
  const stderrSnippet = (repair.judgeStderr ?? "").slice(0, 1600);
  const rawSnippet = (repair.previousRaw ?? "").slice(0, 2400);
  const errorMessage = (repair.errorMessage ?? "").slice(0, 600);

  const failedArtifact = repair.previousDraft
    ? ("reference_workspace" in repair.previousDraft ? "reference_workspace" : "reference_solution")
    : "reference_solution";

  return `You previously generated a problem JSON for this slot, but the ${failedArtifact} FAILED when executed against the test_suite in Docker/JUnit.

Slot requirements:
- Difficulty: ${slot.difficulty}
- Topics: ${slot.topics.join(", ")}
- Problem style: ${slot.problem_style}
- Constraints: ${slot.constraints}
- Java 17, no package declarations
- test_suite must have exactly 8 @Test methods (JUnit 5)
${ctx?.domain ? `\nScenario seed: ${ctx.domain}\n` : ""}
${ctx?.avoidDomains?.length ? `Avoid repeating domains: ${ctx.avoidDomains.join(", ")}\n` : ""}
${ctx?.avoidTitles?.length ? `Avoid reusing titles too similar to: ${ctx.avoidTitles.join(" | ")}\n` : ""}

Failure output (may include the real assertion failure):
STDOUT:
${stdoutSnippet || "(empty)"}

STDERR:
${stderrSnippet || "(empty)"}

Error reason:
${errorMessage || "(not provided)"}

Hard structure rules (do not violate):
- If using legacy fields: starter_code + reference_solution must be valid Java 17 with no package declarations.
- If using workspace fields: workspace + reference_workspace must be valid Java 17 with no package declarations, and reference_workspace must include the same file paths as workspace.
- Each Java file must not declare more than one public class.
- Keep exactly 8 @Test methods.
- Avoid brittle whitespace expectations like assertEquals(" Bob  White ", ...) unless the problem explicitly specifies whitespace behavior.

Here is your previous output (may be truncated):
${rawSnippet || "(not provided)"}

Here is your previous JSON (preferred to edit if present):
${previousJson || "(not provided)"}

Goal:
- Return corrected JSON with the exact same fields.
- Prefer keeping id/title/description/starter_code stable.
- Prefer fixing the reference solution artifact to satisfy the existing tests.
- Only change test_suite if it is clearly inconsistent with the description or contains an obvious mistake; otherwise keep tests stable.
- The final test_suite + reference artifact MUST compile and MUST pass in Docker/JUnit.
- Keep tests meaningful (no trivial assertions).

Return ONLY valid JSON. No markdown. No code fences. No prose.`;
}

function buildPythonRepairPrompt(slot: ProblemSlot, repair: RepairContext, ctx?: SlotPromptContext): string {
  const previousJson =
    repair.previousDraft != null ? JSON.stringify(repair.previousDraft, null, 2) : null;
  const stdoutSnippet = (repair.judgeStdout ?? "").slice(0, 1600);
  const stderrSnippet = (repair.judgeStderr ?? "").slice(0, 1600);
  const rawSnippet = (repair.previousRaw ?? "").slice(0, 2400);
  const errorMessage = (repair.errorMessage ?? "").slice(0, 600);

  return `You previously generated a problem JSON for this slot, but the reference_solution FAILED when executed against the test_suite in Docker/pytest.

Slot requirements:
- Difficulty: ${slot.difficulty}
- Topics: ${slot.topics.join(", ")}
- Problem style: ${slot.problem_style}
- Constraints: ${slot.constraints}
- Python 3.11
- test_suite must use pytest and define exactly 8 tests named test_case_1..test_case_8

${ctx?.domain ? `\nScenario seed: ${ctx.domain}\n` : ""}
${ctx?.avoidDomains?.length ? `Avoid repeating domains: ${ctx.avoidDomains.join(", ")}\n` : ""}
${ctx?.avoidTitles?.length ? `Avoid reusing titles too similar to: ${ctx.avoidTitles.join(" | ")}\n` : ""}

Failure output:
STDOUT:
${stdoutSnippet || "(empty)"}

STDERR:
${stderrSnippet || "(empty)"}

Error reason:
${errorMessage || "(not provided)"}

Hard structure rules (do not violate):
- starter_code and reference_solution must define solve(...)
- solve(...) must NOT read from stdin (no input(), no sys.stdin.*) and must not use networking or randomness
- For problem_style=return: solve(...) must NOT print; tests must assert solve(...) == expected
- For problem_style=stdout: solve(...) should print the answer; tests must capture stdout via capsys and assert on captured.out
- For problem_style=mixed: solve(...) should return the answer AND print it; tests must assert both return and captured.out
- test_suite must import solve via: from solution import solve
- No print-based tests, no randomness, no pytest.approx
- Keep exactly 8 tests: test_case_1..test_case_8

Here is your previous output (may be truncated):
${rawSnippet || "(not provided)"}

Here is your previous JSON (preferred to edit if present):
${previousJson || "(not provided)"}

Goal:
- Return corrected JSON with the exact same fields.
- Prefer keeping id/title/description/starter_code stable.
- You MAY update test_suite and/or reference_solution, but the final pair MUST pass in Docker/pytest.

Return ONLY valid JSON. No markdown. No code fences. No prose.`;
}

function buildCppRepairPrompt(slot: ProblemSlot, repair: RepairContext, ctx?: SlotPromptContext): string {
  const previousJson =
    repair.previousDraft != null ? JSON.stringify(repair.previousDraft, null, 2) : null;
  const stdoutSnippet = (repair.judgeStdout ?? "").slice(0, 1600);
  const stderrSnippet = (repair.judgeStderr ?? "").slice(0, 1600);
  const rawSnippet = (repair.previousRaw ?? "").slice(0, 2400);
  const errorMessage = (repair.errorMessage ?? "").slice(0, 600);

  return `You previously generated a problem JSON for this slot, but the reference_solution FAILED when executed against the test_suite in Docker/g++.

Slot requirements:
- Difficulty: ${slot.difficulty}
- Topics: ${slot.topics.join(", ")}
- Problem style: ${slot.problem_style}
- Constraints: ${slot.constraints}
- C++20 (g++)
- test_suite must include exactly 8 RUN_TEST("test_case_1".. "test_case_8", ...) tests

${ctx?.domain ? `\nScenario seed: ${ctx.domain}\n` : ""}
${ctx?.avoidDomains?.length ? `Avoid repeating domains: ${ctx.avoidDomains.join(", ")}\n` : ""}
${ctx?.avoidTitles?.length ? `Avoid reusing titles too similar to: ${ctx.avoidTitles.join(" | ")}\n` : ""}

Failure output:
STDOUT:
${stdoutSnippet || "(empty)"}

STDERR:
${stderrSnippet || "(empty)"}

Error reason:
${errorMessage || "(not provided)"}

Hard structure rules (do not violate):
- starter_code and reference_solution must define solve(...) (no main())
- test_suite must #include "solution.cpp" and define main()
- Keep exactly 8 tests: test_case_1..test_case_8 using RUN_TEST("test_case_N", { ... })
- IMPORTANT: RUN_TEST must be a VARIADIC macro: #define RUN_TEST(name, ...) ... __VA_ARGS__ ...
  (otherwise commas inside test blocks break compilation)
- Tests must be deterministic.
- solve(...) must NOT read from stdin (no cin/scanf/getline/etc).
- For problem_style=return: tests should compare returned values (no output capture).
- For problem_style=stdout: tests should capture std::cout output (redirect rdbuf) and compare printed output.
- For problem_style=mixed: tests should compare BOTH the returned value and captured std::cout output.
- Tests must print one line per test: [PASS] test_case_N or [FAIL] test_case_N

Here is your previous output (may be truncated):
${rawSnippet || "(not provided)"}

Here is your previous JSON (preferred to edit if present):
${previousJson || "(not provided)"}

Goal:
- Return corrected JSON with the exact same fields.
- Prefer keeping id/title/description/starter_code stable.
- You MAY update test_suite and/or reference_solution, but the final pair MUST pass in Docker/g++.

Return ONLY valid JSON. No markdown. No code fences. No prose.`;
}

function buildSqlRepairPrompt(slot: ProblemSlot, repair: RepairContext, ctx?: SlotPromptContext): string {
  const previousJson =
    repair.previousDraft != null ? JSON.stringify(repair.previousDraft, null, 2) : null;
  const stdoutSnippet = (repair.judgeStdout ?? "").slice(0, 1600);
  const stderrSnippet = (repair.judgeStderr ?? "").slice(0, 1600);
  const rawSnippet = (repair.previousRaw ?? "").slice(0, 2400);
  const errorMessage = (repair.errorMessage ?? "").slice(0, 600);

  return `You previously generated a problem JSON for this slot, but the reference_solution FAILED when executed against the test_suite in Docker/SQLite.

Slot requirements:
- Difficulty: ${slot.difficulty}
- Topics: ${slot.topics.join(", ")}
- Problem style: ${slot.problem_style}
- Constraints: ${slot.constraints}
- SQLite 3
- test_suite must be valid JSON with schema_sql + exactly 8 cases: test_case_1..test_case_8

${ctx?.domain ? `\nScenario seed: ${ctx.domain}\n` : ""}
${ctx?.avoidDomains?.length ? `Avoid repeating domains: ${ctx.avoidDomains.join(", ")}\n` : ""}
${ctx?.avoidTitles?.length ? `Avoid reusing titles too similar to: ${ctx.avoidTitles.join(" | ")}\n` : ""}

Failure output:
STDOUT:
${stdoutSnippet || "(empty)"}

STDERR:
${stderrSnippet || "(empty)"}

Error reason:
${errorMessage || "(not provided)"}

Hard structure rules (do not violate):
- starter_code and reference_solution must be a single read-only query (WITH/SELECT only)
- test_suite must be valid JSON (not code); include schema_sql + 8 cases
- Each case expected.columns must match actual output column names
- KEY FIX: If "Expected rows" mismatches "Actual rows" by order, you MUST add "ORDER BY" to the query and set "order_matters": true.
- KEY FIX: If "Actual rows" are empty or wrong, check your JOIN/WHERE logic.

Here is your previous output (may be truncated):
${rawSnippet || "(not provided)"}

Here is your previous JSON (preferred to edit if present):
${previousJson || "(not provided)"}

Goal:
- Return corrected JSON with the exact same fields.
- Prefer keeping id/title/description/starter_code stable.
- You MAY update test_suite and/or reference_solution, but the final pair MUST pass in Docker/SQLite.

Return ONLY valid JSON. No markdown. No code fences. No prose.`;
}

function buildRepairPrompt(slot: ProblemSlot, repair: RepairContext, ctx?: SlotPromptContext): string {
  if (slot.language === "python") return buildPythonRepairPrompt(slot, repair, ctx);
  if (slot.language === "cpp") return buildCppRepairPrompt(slot, repair, ctx);
  if (slot.language === "sql") return buildSqlRepairPrompt(slot, repair, ctx);
  return buildJavaRepairPrompt(slot, repair, ctx);
}

/**
 * Generate a single problem for the given slot via one Codex LLM call.
 *
 * Returns GeneratedProblemDraft (includes reference_solution).
 * Validates JSON shape and test suite structure.
 * Does NOT validate reference solution via Docker (that's the next step).
 * Does NOT retry (caller handles retries).
 *
 * Throws on any validation failure.
 */
export async function generateSingleProblem(
  slot: ProblemSlot,
  opts?: { repair?: RepairContext; promptContext?: SlotPromptContext }
): Promise<GeneratedDraftWithMeta> {
  const prompt = opts?.repair
    ? buildRepairPrompt(slot, opts.repair, opts.promptContext)
    : buildSlotPromptWithContext(slot, opts?.promptContext);
  trace("generation.slot.start", { slotIndex: slot.index, difficulty: slot.difficulty, repair: Boolean(opts?.repair) });
  traceText("generation.prompt", prompt, { extra: { slotIndex: slot.index, repair: Boolean(opts?.repair) } });

  const completion = await createCodemmCompletion({
    system: getSystemPromptForSlot(slot),
    user: prompt,
    ...(CODEX_MODEL ? { model: CODEX_MODEL } : {}),
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  });

  const text = completion.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
  const llmOutputHash = sha256(text);
  traceText("generation.llm.raw", text, { extra: { slotIndex: slot.index } });

  try {
    // Parse JSON (reuse legacy robust parser)
    const parsed = tryParseJson(text);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("LLM response is not a valid JSON object.");
    }

    // Normalize fields (defensive, same pattern as legacy agent)
    const raw = parsed as any;

    if (slot.language === "python") {
      if (raw.workspace || raw.reference_workspace) {
        throw new Error("Python generation does not support workspace problems yet.");
      }

      const baseId =
        typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();

      const title =
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : `Problem for ${slot.topics[0] ?? "Python"}`;

      const description =
        typeof raw.description === "string" && raw.description.trim()
          ? raw.description.trim()
          : `Problem description for ${title}.`;

      let starterCode =
        typeof raw.starter_code === "string" && raw.starter_code.trim() ? raw.starter_code.trim() : "";
      if (!starterCode.trim()) {
        starterCode = "def solve(x):\n    # TODO: implement\n    raise NotImplementedError\n";
      }

      const testSuite =
        typeof raw.test_suite === "string" && raw.test_suite.trim() ? raw.test_suite.trim() : "";
      // Note: if the LLM omitted test_suite (or returned an invalid one), we attempt a one-shot
      // repair later after schema validation.

      const referenceSolution =
        typeof raw.reference_solution === "string" && raw.reference_solution.trim()
          ? raw.reference_solution.trim()
          : "";
      if (!referenceSolution.trim()) {
        throw new Error(`Missing reference_solution for slot ${slot.index}.`);
      }

      const constraints =
        typeof raw.constraints === "string" && raw.constraints.trim()
          ? raw.constraints.trim()
          : slot.constraints;

      const sampleInputs = Array.isArray(raw.sample_inputs)
        ? (raw.sample_inputs as string[])
        : [];

      const sampleOutputs = Array.isArray(raw.sample_outputs)
        ? (raw.sample_outputs as string[])
        : [];

      const difficulty = slot.difficulty;
      const topicTag = slot.topics[0] ?? "oop";

      const draft: GeneratedProblemDraft = {
        language: "python",
        id: baseId,
        title,
        description,
        starter_code: starterCode,
        test_suite: testSuite,
        reference_solution: referenceSolution,
        constraints,
        sample_inputs: sampleInputs,
        sample_outputs: sampleOutputs,
        difficulty,
        topic_tag: topicTag,
      };

      let result = GeneratedProblemDraftSchema.safeParse(draft);
      if (!result.success) {
        const testSuiteIssue = result.error.issues.some((i) => i.path?.[0] === "test_suite");
        const otherIssues = result.error.issues.some((i) => i.path?.[0] !== "test_suite");

        // Deterministic self-heal pass: if only test_suite is invalid, ask the LLM to repair it.
        if (testSuiteIssue && !otherIssues) {
          const msg =
            result.error.issues
              .slice(0, 6)
              .map((i) => `${i.path?.length ? i.path.join(".") : "root"}: ${i.message}`)
              .join(" | ") || "unknown error";

          const repairedTestSuite = await repairPythonTestSuite({
            slot,
            title,
            description,
            constraints,
            starterCode,
            referenceSolution,
            previousTestSuite: testSuite,
            errorMessage: msg,
          });
          const repairedDraft: GeneratedProblemDraft = { ...draft, test_suite: repairedTestSuite };
          result = GeneratedProblemDraftSchema.safeParse(repairedDraft);
          if (result.success) {
            trace("generation.python.testSuite.repaired", { slotIndex: slot.index, title });
          } else {
            const firstError = result.error.issues[0];
            throw new Error(
              `Generated problem for slot ${slot.index} failed schema validation after Python test_suite repair: ${firstError?.message ?? "unknown error"}`
            );
          }
        } else {
          const firstError = result.error.issues[0];
          throw new Error(
            `Generated problem for slot ${slot.index} failed schema validation: ${firstError?.message ?? "unknown error"}`
          );
        }
      }

      const style = normalizeProblemStyle(slot.problem_style);
      const parsed = result.data;
      if (!("reference_solution" in parsed)) {
        throw new Error("Internal error: expected Python draft to include reference_solution.");
      }

      if (!isValidPytestTestSuiteForStyle(parsed.test_suite, style, 8)) {
        throw new Error(
          `Invalid test_suite for slot ${slot.index}: does not match problem_style=${style} requirements.`
        );
      }
      if (style === "return") {
        if (hasPythonStdoutWrites(parsed.reference_solution)) {
          throw new Error(
            `Invalid reference_solution for slot ${slot.index}: problem_style=return must not write to stdout (no print/sys.stdout).`
          );
        }
      } else {
        if (!hasPythonStdoutWrites(parsed.reference_solution)) {
          throw new Error(
            `Invalid reference_solution for slot ${slot.index}: problem_style=${style} must write the final answer to stdout (print/sys.stdout).`
          );
        }
      }

      trace("generation.draft.meta", { slotIndex: slot.index, title, language: "python", difficulty, topicTag });
      return { draft: parsed, meta: { llmOutputHash } };
    }

    if (slot.language === "cpp") {
      if (raw.workspace || raw.reference_workspace) {
        throw new Error("C++ generation does not support workspace problems yet.");
      }

      const baseId =
        typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();

      const title =
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : `Problem for ${slot.topics[0] ?? "C++"}`;

      const description =
        typeof raw.description === "string" && raw.description.trim()
          ? raw.description.trim()
          : `Problem description for ${title}.`;

      let starterCode =
        typeof raw.starter_code === "string" && raw.starter_code.trim() ? raw.starter_code.trim() : "";
      if (!starterCode.trim()) {
        starterCode =
          '#include <bits/stdc++.h>\\n\\n// Implement solve(...) below.\\n// Avoid I/O in solve().\\nauto solve(auto x) { (void)x; return 0; }\\n';
      }

      const testSuite =
        typeof raw.test_suite === "string" && raw.test_suite.trim() ? raw.test_suite.trim() : "";
      if (!testSuite.trim()) {
        throw new Error(`Invalid test_suite for slot ${slot.index}: missing.`);
      }

      const referenceSolution =
        typeof raw.reference_solution === "string" && raw.reference_solution.trim()
          ? raw.reference_solution.trim()
          : "";
      if (!referenceSolution.trim()) {
        throw new Error(`Missing reference_solution for slot ${slot.index}.`);
      }

      // Starter code must include a real solve(...) definition (comments don't count).
      // If the model only returned includes + a comment, deterministically synthesize a minimal
      // starter implementation based on the reference_solution signature (without leaking the solution body).
      if (!/\bsolve\s*\(/.test(stripCppComments(starterCode))) {
        const synthesized = synthesizeCppStarterCodeFromReference({
          referenceSolution,
          fallbackTopic: slot.topics[0] ?? "cpp",
        });
        if (synthesized) {
          starterCode = synthesized.trim();
        }
      }

      const constraints =
        typeof raw.constraints === "string" && raw.constraints.trim()
          ? raw.constraints.trim()
          : slot.constraints;

      const sampleInputs = Array.isArray(raw.sample_inputs)
        ? (raw.sample_inputs as string[])
        : [];

      const sampleOutputs = Array.isArray(raw.sample_outputs)
        ? (raw.sample_outputs as string[])
        : [];

      const difficulty = slot.difficulty;
      const topicTag = slot.topics[0] ?? "oop";

      const draft: GeneratedProblemDraft = {
        language: "cpp",
        id: baseId,
        title,
        description,
        starter_code: starterCode,
        test_suite: testSuite,
        reference_solution: referenceSolution,
        constraints,
        sample_inputs: sampleInputs,
        sample_outputs: sampleOutputs,
        difficulty,
        topic_tag: topicTag,
      };

      let result = GeneratedProblemDraftSchema.safeParse(draft);
      if (!result.success) {
        const testSuiteIssue = result.error.issues.some((i) => i.path?.[0] === "test_suite");
        const diagnostics = testSuiteIssue ? diagnoseCppTestSuite(draft.test_suite) : undefined;
        if (diagnostics) {
          const maybeIncludeSnippet = process.env.CODEMM_TRACE_TEST_SUITES === "1";
          trace("generation.cpp.testSuite.invalid", {
            slotIndex: slot.index,
            checks: diagnostics,
            ...(maybeIncludeSnippet ? { testSuiteSnippet: draft.test_suite.slice(0, 2000) } : {}),
          });
        }

        const msg =
          result.error.issues
            .slice(0, 6)
            .map((i) => `${i.path?.length ? i.path.join(".") : "root"}: ${i.message}`)
            .join(" | ") || "unknown error";
        const msgWithDiagnostics =
          diagnostics ? `${msg} | cpp_test_suite_checks=${JSON.stringify(diagnostics)}` : msg;

        // One deterministic self-heal pass: if only test_suite is invalid, ask the LLM to repair the test suite
        // (keeps the overall problem stable while enforcing the strict harness contract).
        const failedTestSuite = testSuiteIssue;
        if (failedTestSuite) {
          const repairedTestSuite = await repairCppTestSuite({
            slot,
            title,
            description,
            constraints,
            starterCode,
            referenceSolution,
            previousTestSuite: testSuite,
            errorMessage: msgWithDiagnostics,
          });
          const repairedDraft: GeneratedProblemDraft = { ...draft, test_suite: repairedTestSuite };
          result = GeneratedProblemDraftSchema.safeParse(repairedDraft);
          if (result.success) {
            trace("generation.cpp.testSuite.repaired", { slotIndex: slot.index, title });
          } else {
            const repairedDiagnostics = diagnoseCppTestSuite(repairedTestSuite);
            const maybeIncludeSnippet = process.env.CODEMM_TRACE_TEST_SUITES === "1";
            trace("generation.cpp.testSuite.repair_invalid", {
              slotIndex: slot.index,
              checks: repairedDiagnostics,
              ...(maybeIncludeSnippet ? { testSuiteSnippet: repairedTestSuite.slice(0, 2000) } : {}),
            });

            throw new Error(
              `Generated problem for slot ${slot.index} failed schema validation after C++ test_suite repair: ${msgWithDiagnostics} | repaired_cpp_test_suite_checks=${JSON.stringify(repairedDiagnostics)}`
            );
          }
        }

        if (!result.success) {
          throw new Error(
            `Generated problem for slot ${slot.index} failed schema validation: ${msgWithDiagnostics}`
          );
        }
      }

      trace("generation.draft.meta", { slotIndex: slot.index, title, language: "cpp", difficulty, topicTag });
      const style = normalizeProblemStyle(slot.problem_style);
      const parsed = result.data;
      if (!("reference_solution" in parsed)) {
        throw new Error("Internal error: expected C++ draft to include reference_solution.");
      }
      if (style === "return") {
        if (hasCppStdoutWrites(parsed.reference_solution)) {
          throw new Error(
            `Invalid reference_solution for slot ${slot.index}: problem_style=return must not write to stdout/stderr (no cout/cerr/printf).`
          );
        }
        if (looksLikeCppTestSuiteCapturesStdout(parsed.test_suite)) {
          throw new Error(
            `Invalid test_suite for slot ${slot.index}: problem_style=return should not capture stdout; compare returned values instead.`
          );
        }
      } else {
        if (!hasCppStdoutWrites(parsed.reference_solution)) {
          throw new Error(
            `Invalid reference_solution for slot ${slot.index}: problem_style=${style} must write the final answer to stdout (use std::cout).`
          );
        }
        if (!looksLikeCppTestSuiteCapturesStdout(parsed.test_suite)) {
          throw new Error(
            `Invalid test_suite for slot ${slot.index}: problem_style=${style} must capture std::cout output and assert on it (redirect rdbuf).`
          );
        }
      }
      return { draft: parsed, meta: { llmOutputHash } };
    }

    if (slot.language === "sql") {
      if (raw.workspace || raw.reference_workspace) {
        throw new Error("SQL generation does not support workspace problems.");
      }

      const baseId =
        typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();

      const title =
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : `Problem for ${slot.topics[0] ?? "SQL"}`;

      const description =
        typeof raw.description === "string" && raw.description.trim()
          ? raw.description.trim()
          : `Problem description for ${title}.`;

      let starterCode =
        typeof raw.starter_code === "string" && raw.starter_code.trim() ? raw.starter_code.trim() : "";
      if (!starterCode.trim()) starterCode = "SELECT 1;";

      const testSuite = coerceSqlTestSuiteToJsonString((raw as any).test_suite, 8);
      if (!testSuite.trim()) {
        throw new Error(`Invalid test_suite for slot ${slot.index}: missing.`);
      }

      const referenceSolution =
        typeof raw.reference_solution === "string" && raw.reference_solution.trim()
          ? raw.reference_solution.trim()
          : "";
      if (!referenceSolution.trim()) {
        throw new Error(`Missing reference_solution for slot ${slot.index}.`);
      }

      const constraints =
        typeof raw.constraints === "string" && raw.constraints.trim()
          ? raw.constraints.trim()
          : slot.constraints;

      const sampleInputs = Array.isArray(raw.sample_inputs)
        ? (raw.sample_inputs as string[])
        : [];

      const sampleOutputs = Array.isArray(raw.sample_outputs)
        ? (raw.sample_outputs as string[])
        : [];

      const difficulty = slot.difficulty;
      const topicTag = slot.topics[0] ?? "oop";

      const draft: GeneratedProblemDraft = {
        language: "sql",
        id: baseId,
        title,
        description,
        starter_code: starterCode,
        test_suite: testSuite,
        reference_solution: referenceSolution,
        constraints,
        sample_inputs: sampleInputs,
        sample_outputs: sampleOutputs,
        difficulty,
        topic_tag: topicTag,
      };

      const result = GeneratedProblemDraftSchema.safeParse(draft);
      if (!result.success) {
        const firstError = result.error.issues[0];
        throw new Error(
          `Generated problem for slot ${slot.index} failed schema validation: ${firstError?.message ?? "unknown error"}`
        );
      }

      trace("generation.draft.meta", { slotIndex: slot.index, title, language: "sql", difficulty, topicTag });
      return { draft: result.data, meta: { llmOutputHash } };
    }

    // Workspace variant (Phase B): accept workspace + reference_workspace.
    if (raw.workspace && raw.reference_workspace) {
      const title =
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : `Problem for ${slot.topics[0] ?? "Java"}`;

      const description =
        typeof raw.description === "string" && raw.description.trim()
          ? raw.description.trim()
          : `Problem description for ${title}.`;

      const testSuite =
        typeof raw.test_suite === "string" && raw.test_suite.trim() ? raw.test_suite.trim() : "";
      if (!isValidJUnit5TestSuite(testSuite, 8)) {
        throw new Error(
          `Invalid test_suite for slot ${slot.index}: must have exactly 8 @Test methods, JUnit 5 imports, no package, and non-trivial assertions.`
        );
      }
      if (hasBrittleWhitespaceStringExpectations(testSuite)) {
        throw new Error(
          `Invalid test_suite for slot ${slot.index}: avoid assertEquals() against string literals with leading/trailing whitespace (brittle).`
        );
      }

      const target = getWorkspaceTargetFile(raw);
      if (!target || typeof target.path !== "string") {
        throw new Error("workspace must include at least one file.");
      }

      const targetClassName = target.path.replace(/\.java$/i, "");
      const expectedTestClassName = `${targetClassName}Test`;
      const actualTestClassName = inferClassName(testSuite, expectedTestClassName);
      if (actualTestClassName !== expectedTestClassName) {
        throw new Error(
          `Test suite class name "${actualTestClassName}" must match "${expectedTestClassName}".`
        );
      }

      const referencesTarget = new RegExp(`\\b${targetClassName}\\b`).test(testSuite);
      if (!referencesTarget) {
        throw new Error(
          `Test suite for slot ${slot.index} does not reference class "${targetClassName}".`
        );
      }

      // Ensure file constraints: at most one public class per file + filename matches public class.
      for (const file of raw.workspace.files as any[]) {
        if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
        if (getTopLevelPublicTypeNames(file.content).length > 1) {
          throw new Error(`File "${file.path}" must not declare more than one top-level public type.`);
        }
        assertJavaFilenameMatchesPublicClass(file.path, file.content);
      }

      for (const file of raw.reference_workspace.files as any[]) {
        if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
        if (getTopLevelPublicTypeNames(file.content).length > 1) {
          throw new Error(`File "${file.path}" must not declare more than one top-level public type.`);
        }
        assertJavaFilenameMatchesPublicClass(file.path, file.content);
      }

      // Ensure reference workspace has same file paths.
      const studentPaths = new Set((raw.workspace.files as any[]).map((f) => String(f.path)));
      const refPaths = new Set((raw.reference_workspace.files as any[]).map((f) => String(f.path)));
      if (studentPaths.size !== refPaths.size) {
        throw new Error("reference_workspace must include the same file paths as workspace.");
      }
      for (const p of studentPaths) {
        if (!refPaths.has(p)) {
          throw new Error("reference_workspace must include the same file paths as workspace.");
        }
      }

      const constraints =
        typeof raw.constraints === "string" && raw.constraints.trim()
          ? raw.constraints.trim()
          : slot.constraints;

      const sampleInputs = Array.isArray(raw.sample_inputs)
        ? (raw.sample_inputs as string[])
        : [];

      const sampleOutputs = Array.isArray(raw.sample_outputs)
        ? (raw.sample_outputs as string[])
        : [];

      const difficulty = slot.difficulty;
      const topicTag = slot.topics[0] ?? "oop";

      const draft: GeneratedProblemDraft = {
        language: "java",
        id:
          typeof raw.id === "string" && raw.id.trim()
            ? raw.id.trim()
            : crypto.randomUUID(),
        title,
        description,
        workspace: raw.workspace,
        reference_workspace: raw.reference_workspace,
        test_suite: testSuite,
        constraints,
        sample_inputs: sampleInputs,
        sample_outputs: sampleOutputs,
        difficulty,
        topic_tag: topicTag,
      };

      const result = GeneratedProblemDraftSchema.safeParse(draft);
      if (!result.success) {
        const firstError = result.error.issues[0];
        throw new Error(
          `Generated problem for slot ${slot.index} failed schema validation: ${firstError?.message ?? "unknown error"}`
        );
      }

      trace("generation.draft.meta", { slotIndex: slot.index, title, className: targetClassName, difficulty, topicTag });
      return { draft: result.data, meta: { llmOutputHash } };
    }

    const baseId =
      typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();

    const title =
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : `Problem for ${slot.topics[0] ?? "Java"}`;

    const description =
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : `Problem description for ${title}.`;

    let starterCode =
      typeof raw.starter_code === "string" && raw.starter_code.trim() ? raw.starter_code.trim() : "";

    const starterPublicTypes = getTopLevelPublicTypeNames(starterCode);
    if (starterPublicTypes.length > 1) {
      throw new Error("starter_code must not declare more than one top-level public type.");
    }

    // Infer class name from starter_code (prefer public class name)
    let className = inferPrimaryClassName(starterCode, `Problem${slot.index + 1}`);

    // If starter_code missing or has package, synthesize
    if (!starterCode.trim() || /^\s*package\s+/m.test(starterCode)) {
      starterCode = buildDefaultClassSkeleton(className);
      className = inferPrimaryClassName(starterCode, `Problem${slot.index + 1}`);
    }

    let testSuite =
      typeof raw.test_suite === "string" && raw.test_suite.trim() ? raw.test_suite.trim() : "";

    // Validate test suite structure strictly
    if (!isValidJUnit5TestSuite(testSuite, 8)) {
      throw new Error(
        `Invalid test_suite for slot ${slot.index}: must have exactly 8 @Test methods, JUnit 5 imports, no package, and non-trivial assertions.`
      );
    }
    if (hasBrittleWhitespaceStringExpectations(testSuite)) {
      throw new Error(
        `Invalid test_suite for slot ${slot.index}: avoid assertEquals() against string literals with leading/trailing whitespace (brittle).`
      );
    }

    // Ensure test class name matches starter_code class name + "Test"
    const expectedTestClassName = `${className}Test`;
    const actualTestClassName = inferClassName(testSuite, expectedTestClassName);
    if (actualTestClassName !== expectedTestClassName) {
      throw new Error(
        `Test suite class name "${actualTestClassName}" must match "${expectedTestClassName}".`
      );
    }

    // Ensure test suite references the class
    const referencesClass = new RegExp(`\\b${className}\\b`).test(testSuite);
    if (!referencesClass) {
      throw new Error(
        `Test suite for slot ${slot.index} does not reference class "${className}".`
      );
    }

    let referenceSolution =
      typeof raw.reference_solution === "string" && raw.reference_solution.trim()
        ? raw.reference_solution.trim()
        : "";

    if (!referenceSolution.trim()) {
      throw new Error(`Missing reference_solution for slot ${slot.index}.`);
    }

    const refPublicTypes = getTopLevelPublicTypeNames(referenceSolution);
    if (refPublicTypes.length > 1) {
      throw new Error("reference_solution must not declare more than one top-level public type.");
    }

    // Ensure reference solution has no package
    if (/^\s*package\s+/m.test(referenceSolution)) {
      throw new Error(`reference_solution for slot ${slot.index} contains package declaration.`);
    }

    // Ensure reference solution matches class name (prefer public class too)
    const refClassName = inferPrimaryClassName(referenceSolution, "");
    if (refClassName !== className) {
      throw new Error(
        `reference_solution class name "${refClassName}" does not match starter_code class name "${className}".`
      );
    }

    const constraints =
      typeof raw.constraints === "string" && raw.constraints.trim()
        ? raw.constraints.trim()
        : slot.constraints;

    const sampleInputs = Array.isArray(raw.sample_inputs)
      ? (raw.sample_inputs as string[])
      : [];

    const sampleOutputs = Array.isArray(raw.sample_outputs)
      ? (raw.sample_outputs as string[])
      : [];

    const difficulty = slot.difficulty;
    const topicTag = slot.topics[0] ?? "oop";

    const draft: GeneratedProblemDraft = {
      language: "java",
      id: baseId,
      title,
      description,
      starter_code: starterCode,
      test_suite: testSuite,
      reference_solution: referenceSolution,
      constraints,
      sample_inputs: sampleInputs,
      sample_outputs: sampleOutputs,
      difficulty,
      topic_tag: topicTag,
    };
    trace("generation.draft.meta", { slotIndex: slot.index, title, className, difficulty, topicTag });

    // Validate against GeneratedProblemDraftSchema
    const result = GeneratedProblemDraftSchema.safeParse(draft);
    if (!result.success) {
      const firstError = result.error.issues[0];
      throw new Error(
        `Generated problem for slot ${slot.index} failed schema validation: ${firstError?.message ?? "unknown error"}`
      );
    }

    return { draft: result.data, meta: { llmOutputHash } };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    throw new GenerationContractError(msg, {
      slotIndex: slot.index,
      llmOutputHash,
      rawSnippet: text.slice(0, 2400),
    });
  }
}
