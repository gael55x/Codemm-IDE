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
    const topic = topicsMatch?.[1]?.trim().split(/[,\n]/)[0]?.trim() || "graphs";
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

  function cppDraft(slotIndex, style) {
    if (style === "stdout") {
      return {
        id: `cpp-e2e-${slotIndex}`,
        title: `Print Adder ${slotIndex}`,
        description: "Print a+b.",
        starter_code:
          '#include <bits/stdc++.h>\\n\\nvoid solve(int a, int b) {\\n  // TODO\\n}\\n',
        reference_solution:
          '#include <bits/stdc++.h>\\n\\nvoid solve(int a, int b) {\\n  std::cout << (a + b) << \"\\\\n\";\\n}\\n',
        test_suite: `#include <bits/stdc++.h>
#include "solution.cpp"
static int __codem_failures = 0;
#define RUN_TEST(name, ...) do { \\
  try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\n"; } \\
  catch (...) { std::cout << "[FAIL] " << (name) << "\\n"; __codem_failures++; } \\
} while (0)

static std::string capture_stdout(std::function<void()> fn) {
  std::ostringstream oss;
  auto* old = std::cout.rdbuf(oss.rdbuf());
  fn();
  std::cout.rdbuf(old);
  return oss.str();
}

int main() {
  RUN_TEST("test_case_1", { auto out = capture_stdout([&]{ solve(1,2); }); if (out != "3\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_2", { auto out = capture_stdout([&]{ solve(0,0); }); if (out != "0\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_3", { auto out = capture_stdout([&]{ solve(-1,2); }); if (out != "1\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_4", { auto out = capture_stdout([&]{ solve(10,-3); }); if (out != "7\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_5", { auto out = capture_stdout([&]{ solve(100,23); }); if (out != "123\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_6", { auto out = capture_stdout([&]{ solve(-5,-6); }); if (out != "-11\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_7", { auto out = capture_stdout([&]{ solve(7,8); }); if (out != "15\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_8", { auto out = capture_stdout([&]{ solve(2147483640,7); }); if (out != "2147483647\\n") throw std::runtime_error("fail"); });
  return __codem_failures ? 1 : 0;
}
`,
        constraints:
          "C++20, g++ (GNU), standard library only, no filesystem access, no networking, deterministic behavior.",
        sample_inputs: [],
        sample_outputs: [],
        difficulty: "easy",
        topic_tag: "graphs",
      };
    }

    if (style === "mixed") {
      return {
        id: `cpp-e2e-${slotIndex}`,
        title: `Adder Mixed ${slotIndex}`,
        description: "Return a+b and print it.",
        starter_code:
          '#include <bits/stdc++.h>\\n\\nint solve(int a, int b) {\\n  // TODO\\n  return 0;\\n}\\n',
        reference_solution:
          '#include <bits/stdc++.h>\\n\\nint solve(int a, int b) {\\n  int ans = a + b;\\n  std::cout << ans << \"\\\\n\";\\n  return ans;\\n}\\n',
        test_suite: `#include <bits/stdc++.h>
#include "solution.cpp"
static int __codem_failures = 0;
#define RUN_TEST(name, ...) do { \\
  try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\n"; } \\
  catch (...) { std::cout << "[FAIL] " << (name) << "\\n"; __codem_failures++; } \\
} while (0)

static std::string capture_stdout(std::function<void()> fn) {
  std::ostringstream oss;
  auto* old = std::cout.rdbuf(oss.rdbuf());
  fn();
  std::cout.rdbuf(old);
  return oss.str();
}

int main() {
  RUN_TEST("test_case_1", { int ret = 0; auto out = capture_stdout([&]{ ret = solve(1,2); }); if (ret != 3 || out != "3\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_2", { int ret = 0; auto out = capture_stdout([&]{ ret = solve(0,0); }); if (ret != 0 || out != "0\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_3", { int ret = 0; auto out = capture_stdout([&]{ ret = solve(-1,2); }); if (ret != 1 || out != "1\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_4", { int ret = 0; auto out = capture_stdout([&]{ ret = solve(10,-3); }); if (ret != 7 || out != "7\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_5", { int ret = 0; auto out = capture_stdout([&]{ ret = solve(100,23); }); if (ret != 123 || out != "123\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_6", { int ret = 0; auto out = capture_stdout([&]{ ret = solve(-5,-6); }); if (ret != -11 || out != "-11\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_7", { int ret = 0; auto out = capture_stdout([&]{ ret = solve(7,8); }); if (ret != 15 || out != "15\\n") throw std::runtime_error("fail"); });
  RUN_TEST("test_case_8", { long long ret = 0; auto out = capture_stdout([&]{ ret = solve(2147483640,7); }); if (ret != 2147483647LL || out != "2147483647\\n") throw std::runtime_error("fail"); });
  return __codem_failures ? 1 : 0;
}
`,
        constraints:
          "C++20, g++ (GNU), standard library only, no filesystem access, no networking, deterministic behavior.",
        sample_inputs: [],
        sample_outputs: [],
        difficulty: "easy",
        topic_tag: "graphs",
      };
    }

    return {
      id: `cpp-e2e-${slotIndex}`,
      title: `Adder ${slotIndex}`,
      description: "Return a+b.",
      starter_code: '#include <bits/stdc++.h>\\n\\nint solve(int a, int b) {\\n  // TODO\\n  return 0;\\n}\\n',
      reference_solution: '#include <bits/stdc++.h>\\n\\nint solve(int a, int b) {\\n  return a + b;\\n}\\n',
      test_suite: `#include <bits/stdc++.h>
#include "solution.cpp"
static int __codem_failures = 0;
#define RUN_TEST(name, ...) do { \\
  try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\n"; } \\
  catch (...) { std::cout << "[FAIL] " << (name) << "\\n"; __codem_failures++; } \\
} while (0)
int main() {
  RUN_TEST("test_case_1", { if (solve(1, 2) != 3) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_2", { if (solve(0, 0) != 0) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_3", { if (solve(-1, 2) != 1) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_4", { if (solve(10, -3) != 7) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_5", { if (solve(100, 23) != 123) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_6", { if (solve(-5, -6) != -11) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_7", { if (solve(7, 8) != 15) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_8", { if (solve(2147483640, 7) != 2147483647) throw std::runtime_error("fail"); });
  return __codem_failures ? 1 : 0;
}
`,
      constraints:
        "C++20, g++ (GNU), standard library only, no filesystem access, no networking, deterministic behavior.",
      sample_inputs: [],
      sample_outputs: [],
      difficulty: "easy",
      topic_tag: "graphs",
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

    if (String(system).includes("C++ problem generator")) {
      const style = parseStyleFromSlotPrompt(user);
      const draft = cppDraft(generationCall++, style);
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

test("e2e activity generation (cpp): 2/4/7 problems across stdout/return/mixed", async (t) => {
  const { calls } = installStubs(t, "cpp");

  const suffix = crypto.randomUUID().slice(0, 8);
  const userId = userDb.create(`e2e_cpp_${suffix}`, `e2e_cpp_${suffix}@example.com`, "hash");

  const counts = [2, 4, 7];
  const styles = ["stdout", "return", "mixed"];

  for (const problem_count of counts) {
    for (const style of styles) {
      await t.test(`count=${problem_count} style=${style}`, async () => {
        calls.length = 0;

        const { sessionId } = createSession(userId, "practice");
        const prompt = `Create ${problem_count} easy problems in C++ with ${style} style. Topics: graphs`;

        const msgRes = await processSessionMessage(sessionId, prompt);
        assert.equal(msgRes.accepted, true);
        assert.equal(msgRes.done, true);
        assert.equal(msgRes.state, "READY");
        assert.equal(msgRes.spec.language, "cpp");
        assert.equal(msgRes.spec.problem_count, problem_count);
        assert.equal(msgRes.spec.problem_style, style);

        const genRes = await generateFromSession(sessionId, userId);
        assert.ok(genRes.activityId);
        assert.equal(genRes.problems.length, problem_count);
        for (const p of genRes.problems) {
          assert.equal(p.language, "cpp");
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
