require("../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { listTestFiles } = require("../../../scripts/runTests");

test("runTests: lists only .test.js files for unit", () => {
  const files = listTestFiles("unit");
  assert.ok(Array.isArray(files));
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.ok(f.endsWith(".test.js"));
    assert.equal(f.includes(`${path.sep}helpers${path.sep}`), false);
    assert.equal(f.includes(`${path.sep}integration${path.sep}`), false);
  }
});

test("runTests: lists unit+integration when kind=all", () => {
  const files = listTestFiles("all");
  assert.ok(files.some((f) => f.includes(`${path.sep}unit${path.sep}`)));
  assert.ok(files.some((f) => f.includes(`${path.sep}integration${path.sep}`)));
});

test("runTests: supports per-component filtering", () => {
  const gen = listTestFiles("unit", "generation");
  assert.ok(gen.length > 0);
  assert.ok(gen.every((f) => f.includes(`${path.sep}unit${path.sep}generation${path.sep}`)));

  const cpp = listTestFiles("unit", `languages${path.sep}cpp`);
  assert.ok(cpp.length > 0);
  assert.ok(cpp.every((f) => f.includes(`${path.sep}unit${path.sep}languages${path.sep}cpp${path.sep}`)));
});
