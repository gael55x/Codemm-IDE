require("../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { generateProblemsFromPlan } = require("../../../src/generation");

function mkCppDraft(slot) {
  return {
    draft: {
      language: "cpp",
      id: `cpp-${slot.index}`,
      title: "Retry Limit Stub",
      description: "stub",
      starter_code: "#include <bits/stdc++.h>\n\nint solve() { return 0; }\n",
      reference_solution: "#include <bits/stdc++.h>\n\nint solve() { return 0; }\n",
      test_suite: `#include <bits/stdc++.h>
#include "solution.cpp"
static int __codem_failures = 0;
#define RUN_TEST(name, ...) do { \\
  try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\n"; } \\
  catch (const std::exception&) { std::cout << "[FAIL] " << (name) << "\\n"; __codem_failures++; } \\
  catch (...) { std::cout << "[FAIL] " << (name) << "\\n"; __codem_failures++; } \\
} while (0)
int main() {
  RUN_TEST("test_case_1", { if (solve() != 0) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_2", { if (solve() != 0) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_3", { if (solve() != 0) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_4", { if (solve() != 0) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_5", { if (solve() != 0) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_6", { if (solve() != 0) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_7", { if (solve() != 0) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_8", { if (solve() != 0) throw std::runtime_error("fail"); });
  return __codem_failures ? 1 : 0;
}
`,
      constraints: slot.constraints,
      sample_inputs: [],
      sample_outputs: [],
      difficulty: slot.difficulty,
      topic_tag: slot.topics[0],
    },
    meta: { llmOutputHash: "stub" },
  };
}

function mkPythonDraft(slot) {
  return {
    draft: {
      language: "python",
      id: `py-${slot.index}`,
      title: "Retry Limit Stub",
      description: "stub",
      starter_code: "def solve():\n    return 0\n",
      reference_solution: "def solve():\n    return 0\n",
      test_suite: `import pytest
from solution import solve

def test_case_1(): assert solve() == 0
def test_case_2(): assert solve() == 0
def test_case_3(): assert solve() == 0
def test_case_4(): assert solve() == 0
def test_case_5(): assert solve() == 0
def test_case_6(): assert solve() == 0
def test_case_7(): assert solve() == 0
def test_case_8(): assert solve() == 0
`,
      constraints: slot.constraints,
      sample_inputs: [],
      sample_outputs: [],
      difficulty: slot.difficulty,
      topic_tag: slot.topics[0],
    },
    meta: { llmOutputHash: "stub" },
  };
}

test("generation: retries C++ up to 5 attempts", async () => {
  const plan = [
    {
      index: 0,
      language: "cpp",
      difficulty: "easy",
      topics: ["graphs"],
      problem_style: "return",
      constraints: "C++20, g++ (GNU), standard library only.",
    },
  ];

  let generateCalls = 0;
  const generateSingleProblem = async (slot) => {
    generateCalls++;
    return mkCppDraft(slot);
  };

  let validateCalls = 0;
  const validateReferenceSolution = async () => {
    validateCalls++;
    throw new Error("fail");
  };

  await assert.rejects(() =>
    generateProblemsFromPlan(plan, { deps: { generateSingleProblem, validateReferenceSolution } })
  );

  assert.equal(generateCalls, 5);
  assert.equal(validateCalls, 5);
});

test("generation: retries non-C++ up to 3 attempts", async () => {
  const plan = [
    {
      index: 0,
      language: "python",
      difficulty: "easy",
      topics: ["strings"],
      problem_style: "return",
      constraints: "Python 3.11, deterministic.",
    },
  ];

  let generateCalls = 0;
  const generateSingleProblem = async (slot) => {
    generateCalls++;
    return mkPythonDraft(slot);
  };

  let validateCalls = 0;
  const validateReferenceSolution = async () => {
    validateCalls++;
    throw new Error("fail");
  };

  await assert.rejects(() =>
    generateProblemsFromPlan(plan, { deps: { generateSingleProblem, validateReferenceSolution } })
  );

  assert.equal(generateCalls, 3);
  assert.equal(validateCalls, 3);
});
