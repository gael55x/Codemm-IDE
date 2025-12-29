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

  let currentPrompt = "";
  let generationCall = 0;

  function parseRequestedCountAndStyle(msg) {
    const m = String(msg || "");
    const lower = m.toLowerCase();
    const countMatch = lower.match(/\b(\d+)\s+(?:problems?|questions?)\b/);
    const count = countMatch ? Number(countMatch[1]) : 1;
    const style = /\bmixed\b/.test(lower) ? "mixed" : /\bstdout\b/.test(lower) ? "stdout" : "return";
    const topicsMatch = m.match(/\btopics?\s*:\s*([A-Za-z0-9 _-]+)/i);
    const topic = topicsMatch?.[1]?.trim().split(/[,\n]/)[0]?.trim() || "arrays";
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

  function javaDraft(slotIndex) {
    return {
      id: `java-e2e-${slotIndex}`,
      title: `Adder ${slotIndex}`,
      description: "Return a + b.",
      starter_code: `
public class Adder {
  public int solve(int a, int b) {
    // TODO
    return 0;
  }
}
`.trim(),
      reference_solution: `
public class Adder {
  public int solve(int a, int b) {
    return a + b;
  }
}
`.trim(),
      test_suite: `
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class AdderTest {
  @Test void test_case_1(){ assertEquals(3, new Adder().solve(1,2)); }
  @Test void test_case_2(){ assertEquals(0, new Adder().solve(0,0)); }
  @Test void test_case_3(){ assertEquals(-1, new Adder().solve(-2,1)); }
  @Test void test_case_4(){ assertEquals(7, new Adder().solve(10,-3)); }
  @Test void test_case_5(){ assertEquals(123, new Adder().solve(100,23)); }
  @Test void test_case_6(){ assertEquals(-11, new Adder().solve(-5,-6)); }
  @Test void test_case_7(){ assertEquals(15, new Adder().solve(7,8)); }
  @Test void test_case_8(){ assertEquals(2147483647, new Adder().solve(2147483640, 7)); }
}
`.trim(),
      constraints: "Java 17, JUnit 5, no package declarations.",
      sample_inputs: [],
      sample_outputs: [],
      difficulty: "easy",
      topic_tag: "arrays",
    };
  }

  codex.createCodexCompletion = async ({ system, user }) => {
    calls.push({ system, user });

    // Dialogue call
    if (String(system).includes("Codemm's dialogue layer")) {
      const m = String(user).match(/Latest user message:\n([\s\S]*)\n\nReturn JSON with this exact shape:/);
      const latest = m?.[1] ?? "";
      currentPrompt = latest.trim();
      const resp = buildDialogueResponse(currentPrompt);
      return { content: [{ type: "text", text: JSON.stringify(resp) }] };
    }

    // Generation call (Java generator)
    if (String(system).includes("Java problem generator")) {
      const draft = javaDraft(generationCall++);
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

test("e2e activity generation (java): 2/4/7 problems across stdout/return/mixed", async (t) => {
  const { calls } = installStubs(t, "java");

  const suffix = crypto.randomUUID().slice(0, 8);
  const userId = userDb.create(`e2e_java_${suffix}`, `e2e_java_${suffix}@example.com`, "hash");

  const counts = [2, 4, 7];
  const styles = ["stdout", "return", "mixed"];

  for (const problem_count of counts) {
    for (const style of styles) {
      await t.test(`count=${problem_count} style=${style}`, async () => {
        calls.length = 0;

        const { sessionId } = createSession(userId, "practice");
        const prompt = `Create ${problem_count} easy problems in Java with ${style} style. Topics: arrays`;

        const msgRes = await processSessionMessage(sessionId, prompt);
        assert.equal(msgRes.accepted, true);
        assert.equal(msgRes.done, true);
        assert.equal(msgRes.state, "READY");
        assert.equal(msgRes.spec.language, "java");
        assert.equal(msgRes.spec.problem_count, problem_count);
        assert.equal(msgRes.spec.problem_style, style);

        const genRes = await generateFromSession(sessionId, userId);
        assert.ok(genRes.activityId);
        assert.equal(genRes.problems.length, problem_count);
        for (const p of genRes.problems) {
          assert.equal(p.language, "java");
          assert.equal("reference_solution" in p, false);
          assert.equal("reference_workspace" in p, false);
        }

        // Stored activity has correct problem count.
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
