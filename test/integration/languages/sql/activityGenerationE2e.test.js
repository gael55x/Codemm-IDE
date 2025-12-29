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
    const topic = topicsMatch?.[1]?.trim().split(/[,\n]/)[0]?.trim() || "filtering";
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

  function sqlDraft(slotIndex) {
    const suite = {
      schema_sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER);",
      cases: Array.from({ length: 8 }, (_, i) => ({
        name: `test_case_${i + 1}`,
        seed_sql: `INSERT INTO t (id, v) VALUES (${i + 1}, ${i});`,
        expected: { columns: ["v"], rows: [[i]] },
        order_matters: true,
      })),
    };

    return {
      id: `sql-e2e-${slotIndex}`,
      title: `Select V ${slotIndex}`,
      description: "Return v for id=1.",
      starter_code: "SELECT v FROM t WHERE id = 1 ORDER BY v;",
      reference_solution: "SELECT v FROM t WHERE id = 1 ORDER BY v;",
      test_suite: JSON.stringify(suite),
      constraints: "SQLite 3 (SQL dialect), read-only queries only, deterministic results (explicit ORDER BY when needed).",
      sample_inputs: [],
      sample_outputs: [],
      difficulty: "easy",
      topic_tag: "filtering",
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

    if (String(system).includes("SQL problem generator")) {
      const draft = sqlDraft(generationCall++);
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

test("e2e activity generation (sql): 2/4/7 problems across stdout/return/mixed", async (t) => {
  const { calls } = installStubs(t, "sql");

  const suffix = crypto.randomUUID().slice(0, 8);
  const userId = userDb.create(`e2e_sql_${suffix}`, `e2e_sql_${suffix}@example.com`, "hash");

  const counts = [2, 4, 7];
  const styles = ["stdout", "return", "mixed"];

  for (const problem_count of counts) {
    for (const style of styles) {
      await t.test(`count=${problem_count} style=${style}`, async () => {
        calls.length = 0;

        const { sessionId } = createSession(userId, "practice");
        const prompt = `Create ${problem_count} easy problems in SQL with ${style} style. Topics: filtering`;

        const msgRes = await processSessionMessage(sessionId, prompt);
        assert.equal(msgRes.accepted, true);
        assert.equal(msgRes.done, true);
        assert.equal(msgRes.state, "READY");
        assert.equal(msgRes.spec.language, "sql");
        assert.equal(msgRes.spec.problem_count, problem_count);
        assert.equal(msgRes.spec.problem_style, style);

        const genRes = await generateFromSession(sessionId, userId);
        assert.ok(genRes.activityId);
        assert.equal(genRes.problems.length, problem_count);
        for (const p of genRes.problems) {
          assert.equal(p.language, "sql");
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
