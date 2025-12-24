require("ts-node/register");

const test = require("node:test");
const assert = require("node:assert/strict");

const { computeConfirmRequired } = require("../src/agent/fieldCommitmentPolicy");

test("commitment policy: blocks implicit language switch", () => {
  const res = computeConfirmRequired({
    userMessage: "okay whatever you recommend",
    currentSpec: { language: "java" },
    inferredPatch: { language: "python" },
  });

  assert.equal(res.required, true);
  assert.ok(res.fields.includes("language"));
});

test("commitment policy: allows explicit language switch", () => {
  const res = computeConfirmRequired({
    userMessage: "switch to python please",
    currentSpec: { language: "java" },
    inferredPatch: { language: "python" },
  });

  assert.deepEqual(res, { required: false });
});

test('commitment policy: treats "c++" as explicit', () => {
  const res = computeConfirmRequired({
    userMessage: "c++ pls",
    currentSpec: { language: "java" },
    inferredPatch: { language: "cpp" },
  });

  assert.deepEqual(res, { required: false });
});
