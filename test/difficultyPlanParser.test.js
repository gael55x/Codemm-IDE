require("ts-node/register");

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseDifficultyPlanShorthand } = require("../src/agent/difficultyPlanParser");

test('difficulty shorthand: "easy" uses current problem_count and yields mixed plan', () => {
  const res = parseDifficultyPlanShorthand({ text: "easy", currentProblemCount: 4 });
  assert.ok(res);
  assert.deepEqual(res.patch.problem_count, undefined);
  assert.deepEqual(res.patch.difficulty_plan, [
    { difficulty: "easy", count: 3 },
    { difficulty: "medium", count: 1 },
  ]);
});

test('difficulty shorthand: "4 easy" sets problem_count and yields mixed plan', () => {
  const res = parseDifficultyPlanShorthand({ text: "4 easy" });
  assert.ok(res);
  assert.equal(res.patch.problem_count, 4);
  assert.deepEqual(res.patch.difficulty_plan, [
    { difficulty: "easy", count: 3 },
    { difficulty: "medium", count: 1 },
  ]);
});

test('difficulty shorthand: "easy:4" coerces to mixed plan deterministically', () => {
  const res = parseDifficultyPlanShorthand({ text: "easy:4" });
  assert.ok(res);
  assert.equal(res.patch.problem_count, 4);
  assert.deepEqual(res.patch.difficulty_plan, [
    { difficulty: "easy", count: 3 },
    { difficulty: "medium", count: 1 },
  ]);
});

