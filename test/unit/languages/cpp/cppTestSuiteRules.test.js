require("../../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { diagnoseCppTestSuite, isValidCppTestSuite } = require("../../../../src/languages/cpp/rules");

test("cpp test_suite: detects non-variadic RUN_TEST macro", () => {
  const ts = `
#include <bits/stdc++.h>
#include "solution.cpp"
static int __codem_failures = 0;
#define RUN_TEST(name, body) do { body; } while(0)
int main(){
  RUN_TEST("test_case_1", { (void)0; });
  RUN_TEST("test_case_2", { (void)0; });
  RUN_TEST("test_case_3", { (void)0; });
  RUN_TEST("test_case_4", { (void)0; });
  RUN_TEST("test_case_5", { (void)0; });
  RUN_TEST("test_case_6", { (void)0; });
  RUN_TEST("test_case_7", { (void)0; });
  RUN_TEST("test_case_8", { (void)0; });
  return 0;
}
`.trim();

  const d = diagnoseCppTestSuite(ts);
  assert.equal(d.hasVariadicRunTestMacro, false);
  assert.equal(isValidCppTestSuite(ts, 8), false);
});

test("cpp test_suite: requires include + main + 8 tests", () => {
  const ts = `
#include <bits/stdc++.h>
static int __codem_failures = 0;
#define RUN_TEST(name, ...) do { try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\n"; } catch (...) { std::cout << "[FAIL] " << (name) << "\\n"; __codem_failures++; } } while(0)
int main(){
  RUN_TEST("test_case_1", { (void)0; });
  return 0;
}
`.trim();

  const d = diagnoseCppTestSuite(ts);
  assert.equal(d.includesSolutionCpp, false);
  assert.equal(d.foundTestNumbers.length, 1);
  assert.equal(isValidCppTestSuite(ts, 8), false);
});

test("cpp test_suite: passes diagnostics for a well-formed harness", () => {
  const ts = `
#include <bits/stdc++.h>
#include "solution.cpp"
static int __codem_failures = 0;
#define RUN_TEST(name, ...) do { \\
  try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\n"; } \\
  catch (...) { std::cout << "[FAIL] " << (name) << "\\n"; __codem_failures++; } \\
} while (0)
int main() {
  RUN_TEST("test_case_1", { if (1 != 1) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_2", { if (1 != 1) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_3", { if (1 != 1) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_4", { if (1 != 1) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_5", { if (1 != 1) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_6", { if (1 != 1) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_7", { if (1 != 1) throw std::runtime_error("fail"); });
  RUN_TEST("test_case_8", { if (1 != 1) throw std::runtime_error("fail"); });
  return __codem_failures ? 1 : 0;
}
`.trim();

  const d = diagnoseCppTestSuite(ts);
  assert.equal(d.includesSolutionCpp, true);
  assert.equal(d.hasMain, true);
  assert.equal(d.hasRunTestCalls, true);
  assert.equal(d.hasVariadicRunTestMacro, true);
  assert.equal(d.hasPassFailOutput, true);
  assert.deepEqual(d.foundTestNumbers, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(isValidCppTestSuite(ts, 8), true);
});
