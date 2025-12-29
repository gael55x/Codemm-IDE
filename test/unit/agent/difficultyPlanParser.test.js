require("../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseDifficultyPlanShorthand } = require("../../../src/agent/difficultyPlanParser");

test('difficulty shorthand: "easy" uses current problem_count and yields single-bucket plan', () => {
  const res = parseDifficultyPlanShorthand({ text: "easy", currentProblemCount: 4 });
  assert.ok(res);
  assert.deepEqual(res.patch.problem_count, undefined);
  assert.deepEqual(res.patch.difficulty_plan, [
    { difficulty: "easy", count: 4 },
  ]);
});

test('difficulty shorthand: "4 easy" sets problem_count and yields single-bucket plan', () => {
  const res = parseDifficultyPlanShorthand({ text: "4 easy" });
  assert.ok(res);
  assert.equal(res.patch.problem_count, 4);
  assert.deepEqual(res.patch.difficulty_plan, [
    { difficulty: "easy", count: 4 },
  ]);
});

test('difficulty shorthand: "easy:4" yields exact per-difficulty counts', () => {
  const res = parseDifficultyPlanShorthand({ text: "easy:4" });
  assert.ok(res);
  assert.equal(res.patch.problem_count, 4);
  assert.deepEqual(res.patch.difficulty_plan, [
    { difficulty: "easy", count: 4 },
  ]);
});
