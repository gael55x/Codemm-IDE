require("../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyDialogueAct } = require("../../../src/agent/dialogueAct");
const { defaultPatchForGoal } = require("../../../src/agent/deferDefaults");

test("dialogue act: classifies DEFER", () => {
  const res = classifyDialogueAct("any / whatever");
  assert.equal(res.act, "DEFER");
});

test("defer defaults: scope applies safe problem_count default", () => {
  const decision = defaultPatchForGoal("scope", {});
  assert.ok(decision);
  assert.ok(Array.isArray(decision.patch));
  assert.ok(decision.patch.some((op) => op.path === "/problem_count" && op.value === 3));
});

test("defer defaults: no-op when problem_count already set", () => {
  const decision = defaultPatchForGoal("scope", { problem_count: 5 });
  assert.equal(decision, null);
});
