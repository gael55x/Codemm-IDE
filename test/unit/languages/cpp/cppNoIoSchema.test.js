require("../../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { CppSourceSchema } = require("../../../../src/languages/cpp/rules");

test("cpp: CppSourceSchema rejects stdin reads to avoid Docker timeouts", () => {
  const code = `
    #include <bits/stdc++.h>
    int solve(int n) {
      int x;
      std::cin >> x;
      return n + x;
    }
  `;
  const res = CppSourceSchema.safeParse(code);
  assert.equal(res.success, false);
  assert.match(res.error.issues[0].message, /must not read from stdin/i);
});

test("cpp: CppSourceSchema allows pure solve(...) functions", () => {
  const code = `
    #include <bits/stdc++.h>
    int solve(int a, int b) {
      return a + b;
    }
  `;
  const res = CppSourceSchema.safeParse(code);
  assert.equal(res.success, true);
});
