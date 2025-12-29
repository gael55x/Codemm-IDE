require("../../../helpers/setupDb");

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { userDb, activityDb } = require("../../../../src/database");
const { createSession, processSessionMessage, generateFromSession, getSession } = require("../../../../src/services/sessionService");

function installStubs(t, language) {
  const codex = require("../../../../src/infra/llm/codex");
  const validator = require("../../../../src/generation/referenceSolutionValidator");
  const originalCreate = codex.createCodexCompletion;
  const originalValidate = validator.validateReferenceSolution;

  /** @type {{system: string, user: string}[]} */
  const calls = [];

  let generationCall = 0;

  function parseRequestedCountAndStyle(msg) {
    const m = String(msg || "");
    const lower = m.toLowerCase();
    const countMatch = lower.match(/\b(\d+)\s+(?:problems?|questions?)\b/);
    const count = countMatch ? Number(countMatch[1]) : 1;
    const style = /\bmixed\b/.test(lower) ? "mixed" : /\bstdout\b/.test(lower) ? "stdout" : "return";
    const topicsMatch = m.match(/\btopics?\s*:\s*([A-Za-z0-9 _-]+)/i);
    const topic = topicsMatch?.[1]?.trim().split(/[,\n]/)[0]?.trim() || "strings";
    return { count, style, topic };
  }

  function buildDialogueResponse(latestUserMessage) {
    const { count, style, topic } = parseRequestedCountAndStyle(latestUserMessage);
    return {
      acknowledgement: "OK",
      inferred_intent: "Generate an activity.",
      proposedPatch: {
        language,
        problem_count: count,
        difficulty_plan: [{ difficulty: "easy", count }],
        topic_tags: [topic],
        problem_style: style,
      },
    };
  }

  function parseStyleFromSlotPrompt(userPrompt) {
    const m = String(userPrompt || "").match(/^\s*Problem style:\s*([^\n]+)\s*$/im);
    const style = (m?.[1] || "").trim().toLowerCase();
    if (style === "stdout" || style === "mixed" || style === "return") return style;
    return "return";
  }

  function pythonDraft(slotIndex, style) {
    if (style === "stdout") {
      return {
        id: `py-e2e-${slotIndex}`,
        title: `Print Len ${slotIndex}`,
        description: "Print len(s).",
        starter_code: "def solve(s: str) -> None:\n    # TODO\n    raise NotImplementedError\n",
        reference_solution: "def solve(s: str) -> None:\n    print(len(s))\n",
        test_suite: `import pytest
from solution import solve

def test_case_1(capsys): solve(""); captured = capsys.readouterr(); assert captured.out.strip() == "0"
def test_case_2(capsys): solve("a"); captured = capsys.readouterr(); assert captured.out.strip() == "1"
def test_case_3(capsys): solve("abc"); captured = capsys.readouterr(); assert captured.out.strip() == "3"
def test_case_4(capsys): solve("hello"); captured = capsys.readouterr(); assert captured.out.strip() == "5"
def test_case_5(capsys): solve("  "); captured = capsys.readouterr(); assert captured.out.strip() == "2"
def test_case_6(capsys): solve("🙂"); captured = capsys.readouterr(); assert captured.out.strip() == "1"
def test_case_7(capsys): solve("line\\nbreak"); captured = capsys.readouterr(); assert captured.out.strip() == "10"
def test_case_8(capsys): solve("x" * 20); captured = capsys.readouterr(); assert captured.out.strip() == "20"
`,
        constraints:
          "Python 3.11, pytest, standard library only, no filesystem access, no networking, time limit enforced.",
        sample_inputs: [],
        sample_outputs: [],
        difficulty: "easy",
        topic_tag: "strings",
      };
    }

    if (style === "mixed") {
      return {
        id: `py-e2e-${slotIndex}`,
        title: `Len Mixed ${slotIndex}`,
        description: "Return len(s) and print it.",
        starter_code: "def solve(s: str) -> int:\n    # TODO\n    raise NotImplementedError\n",
        reference_solution: "def solve(s: str) -> int:\n    ans = len(s)\n    print(ans)\n    return ans\n",
        test_suite: `import pytest
from solution import solve

def test_case_1(capsys): assert solve("") == 0; captured = capsys.readouterr(); assert captured.out.strip() == "0"
def test_case_2(capsys): assert solve("a") == 1; captured = capsys.readouterr(); assert captured.out.strip() == "1"
def test_case_3(capsys): assert solve("abc") == 3; captured = capsys.readouterr(); assert captured.out.strip() == "3"
def test_case_4(capsys): assert solve("hello") == 5; captured = capsys.readouterr(); assert captured.out.strip() == "5"
def test_case_5(capsys): assert solve("  ") == 2; captured = capsys.readouterr(); assert captured.out.strip() == "2"
def test_case_6(capsys): assert solve("🙂") == 1; captured = capsys.readouterr(); assert captured.out.strip() == "1"
def test_case_7(capsys): assert solve("line\\nbreak") == 10; captured = capsys.readouterr(); assert captured.out.strip() == "10"
def test_case_8(capsys): assert solve("x" * 20) == 20; captured = capsys.readouterr(); assert captured.out.strip() == "20"
`,
        constraints:
          "Python 3.11, pytest, standard library only, no filesystem access, no networking, time limit enforced.",
        sample_inputs: [],
        sample_outputs: [],
        difficulty: "easy",
        topic_tag: "strings",
      };
    }

    return {
      id: `py-e2e-${slotIndex}`,
      title: `Len ${slotIndex}`,
      description: "Return len(s).",
      starter_code: "def solve(s: str) -> int:\n    # TODO\n    raise NotImplementedError\n",
      reference_solution: "def solve(s: str) -> int:\n    return len(s)\n",
      test_suite: `import pytest
from solution import solve

def test_case_1(): assert solve(\"\") == 0
def test_case_2(): assert solve(\"a\") == 1
def test_case_3(): assert solve(\"abc\") == 3
def test_case_4(): assert solve(\"hello\") == 5
def test_case_5(): assert solve(\"  \") == 2
def test_case_6(): assert solve(\"🙂\") == 1
def test_case_7(): assert solve(\"line\\nbreak\") == 10
def test_case_8(): assert solve(\"x\" * 20) == 20
`,
      constraints:
        "Python 3.11, pytest, standard library only, no filesystem access, no networking, time limit enforced.",
      sample_inputs: [],
      sample_outputs: [],
      difficulty: "easy",
      topic_tag: "strings",
    };
  }

  codex.createCodexCompletion = async ({ system, user }) => {
    calls.push({ system, user });

    if (String(system).includes("Codemm's dialogue layer")) {
      const m = String(user).match(/Latest user message:\n([\s\S]*)\n\nReturn JSON with this exact shape:/);
      const latest = m?.[1] ?? "";
      const resp = buildDialogueResponse(latest.trim());
      return { content: [{ type: "text", text: JSON.stringify(resp) }] };
    }

    if (String(system).includes("Python problem generator")) {
      const style = parseStyleFromSlotPrompt(user);
      const draft = pythonDraft(generationCall++, style);
      return { content: [{ type: "text", text: JSON.stringify(draft) }] };
    }

    throw new Error(`Unexpected LLM call in test (system=${String(system).slice(0, 80)})`);
  };

  validator.validateReferenceSolution = async () => {};

  t.after(() => {
    codex.createCodexCompletion = originalCreate;
    validator.validateReferenceSolution = originalValidate;
  });

  return { calls };
}

test("e2e activity generation (python): 2/4/7 problems across stdout/return/mixed", async (t) => {
  const { calls } = installStubs(t, "python");

  const suffix = crypto.randomUUID().slice(0, 8);
  const userId = userDb.create(`e2e_py_${suffix}`, `e2e_py_${suffix}@example.com`, "hash");

  const counts = [2, 4, 7];
  const styles = ["stdout", "return", "mixed"];

  for (const problem_count of counts) {
    for (const style of styles) {
      await t.test(`count=${problem_count} style=${style}`, async () => {
        calls.length = 0;

        const { sessionId } = createSession(userId, "practice");
        const prompt = `Create ${problem_count} easy problems in Python with ${style} style. Topics: strings`;

        const msgRes = await processSessionMessage(sessionId, prompt);
        assert.equal(msgRes.accepted, true);
        assert.equal(msgRes.done, true);
        assert.equal(msgRes.state, "READY");
        assert.equal(msgRes.spec.language, "python");
        assert.equal(msgRes.spec.problem_count, problem_count);
        assert.equal(msgRes.spec.problem_style, style);

        const genRes = await generateFromSession(sessionId, userId);
        assert.ok(genRes.activityId);
        assert.equal(genRes.problems.length, problem_count);
        for (const p of genRes.problems) {
          assert.equal(p.language, "python");
          assert.equal("reference_solution" in p, false);
        }

        const stored = activityDb.findById(genRes.activityId);
        assert.ok(stored);
        const storedProblems = JSON.parse(stored.problems);
        assert.equal(storedProblems.length, problem_count);

        const session = getSession(sessionId);
        assert.equal(session.state, "SAVED");
      });
    }
  }
});
