import crypto from "crypto";
import { createCodexCompletion } from "../infra/llm/codex";
import { tryParseJson } from "../utils/jsonParser";
import { buildDefaultClassSkeleton, inferClassName } from "../utils/javaCodegen";
import { isValidJUnit5TestSuite } from "../contracts/javaRules";
import { GeneratedProblemDraftSchema, type GeneratedProblemDraft } from "../contracts/problem";
import type { ProblemSlot } from "../planner/types";
import { buildSlotPrompt, V1_PROBLEM_GENERATOR_SYSTEM_PROMPT } from "./prompts";
import { trace, traceText } from "../utils/trace";

const CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-4.1";
const MAX_TOKENS = 5000;
const TEMPERATURE = 0.3;

type RepairContext = {
  previousDraft: GeneratedProblemDraft;
  judgeStdout?: string;
  judgeStderr?: string;
};

function buildRepairPrompt(slot: ProblemSlot, repair: RepairContext): string {
  const previousJson = JSON.stringify(repair.previousDraft, null, 2);
  const stdoutSnippet = (repair.judgeStdout ?? "").slice(0, 1600);
  const stderrSnippet = (repair.judgeStderr ?? "").slice(0, 1600);

  return `You previously generated a problem JSON for this slot, but the reference_solution FAILED when executed against the test_suite in Docker/JUnit.

Slot requirements:
- Difficulty: ${slot.difficulty}
- Topics: ${slot.topics.join(", ")}
- Problem style: ${slot.problem_style}
- Constraints: ${slot.constraints}
- Java 17, no package declarations
- test_suite must have exactly 8 @Test methods (JUnit 5)

Failure output (may include the real assertion failure):
STDOUT:
${stdoutSnippet || "(empty)"}

STDERR:
${stderrSnippet || "(empty)"}

Here is your previous JSON.

Goal:
- Return corrected JSON with the exact same fields.
- Prefer keeping id/title/description/starter_code stable.
- You MAY update test_suite and/or reference_solution, but the final pair MUST compile and MUST pass in Docker/JUnit.
- Keep tests meaningful (no trivial assertions).
${previousJson}

Return ONLY valid JSON. No markdown. No code fences. No prose.`;
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
  opts?: { repair?: RepairContext }
): Promise<GeneratedProblemDraft> {
  const prompt = opts?.repair ? buildRepairPrompt(slot, opts.repair) : buildSlotPrompt(slot);
  trace("generation.slot.start", { slotIndex: slot.index, difficulty: slot.difficulty, repair: Boolean(opts?.repair) });
  traceText("generation.prompt", prompt, { extra: { slotIndex: slot.index, repair: Boolean(opts?.repair) } });

  const completion = await createCodexCompletion({
    system: V1_PROBLEM_GENERATOR_SYSTEM_PROMPT,
    user: prompt,
    model: CODEX_MODEL,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  });

  const text = completion.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
  traceText("generation.llm.raw", text, { extra: { slotIndex: slot.index } });

  // Parse JSON (reuse legacy robust parser)
  const parsed = tryParseJson(text);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM response is not a valid JSON object.");
  }

  // Normalize fields (defensive, same pattern as legacy agent)
  const raw = parsed as any;

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

  // Infer class name from starter_code
  let className = inferClassName(starterCode, `Problem${slot.index + 1}`);

  // If starter_code missing or has package, synthesize
  if (!starterCode.trim() || /^\s*package\s+/m.test(starterCode)) {
    starterCode = buildDefaultClassSkeleton(className);
    className = inferClassName(starterCode, `Problem${slot.index + 1}`);
  }

  let testSuite =
    typeof raw.test_suite === "string" && raw.test_suite.trim() ? raw.test_suite.trim() : "";

  // Validate test suite structure strictly
  if (!isValidJUnit5TestSuite(testSuite, 8)) {
    throw new Error(
      `Invalid test_suite for slot ${slot.index}: must have exactly 8 @Test methods, JUnit 5 imports, no package, and non-trivial assertions.`
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

  // Ensure reference solution has no package
  if (/^\s*package\s+/m.test(referenceSolution)) {
    throw new Error(`reference_solution for slot ${slot.index} contains package declaration.`);
  }

  // Ensure reference solution matches class name
  const refClassName = inferClassName(referenceSolution, "");
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

  return result.data;
}
