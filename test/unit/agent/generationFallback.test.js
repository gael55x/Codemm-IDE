require("../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { proposeGenerationFallback } = require("../../../src/agent/generationFallback");

test("generation fallback: switches to return style first", () => {
  const spec = {
    version: "1.0",
    language: "java",
    problem_count: 3,
    difficulty_plan: [
      { difficulty: "easy", count: 2 },
      { difficulty: "medium", count: 1 },
    ],
    topic_tags: ["arrays"],
    problem_style: "stdout",
    constraints: "Java 17, JUnit 5, no package declarations.",
    test_case_count: 8,
  };

  const d = proposeGenerationFallback(spec);
  assert.ok(d);
  assert.match(d.reason, /return-based/i);
  assert.deepEqual(d.patch, [{ op: "replace", path: "/problem_style", value: "return" }]);
});

test("generation fallback: reduces hard to medium after return style", () => {
  const spec = {
    version: "1.0",
    language: "java",
    problem_count: 3,
    difficulty_plan: [
      { difficulty: "easy", count: 1 },
      { difficulty: "hard", count: 2 },
    ],
    topic_tags: ["arrays"],
    problem_style: "return",
    constraints: "Java 17, JUnit 5, no package declarations.",
    test_case_count: 8,
  };

  const d = proposeGenerationFallback(spec);
  assert.ok(d);
  assert.match(d.reason, /reduced hard/i);
  assert.equal(d.patch[0].path, "/difficulty_plan");
  assert.deepEqual(d.patch[0].value, [
    { difficulty: "easy", count: 1 },
    { difficulty: "medium", count: 2 },
  ]);
});

test("generation fallback: narrows topic scope when many tags", () => {
  const spec = {
    version: "1.0",
    language: "java",
    problem_count: 3,
    difficulty_plan: [
      { difficulty: "easy", count: 2 },
      { difficulty: "medium", count: 1 },
    ],
    topic_tags: ["a", "b", "c", "d", "e"],
    problem_style: "return",
    constraints: "Java 17, JUnit 5, no package declarations.",
    test_case_count: 8,
  };

  const d = proposeGenerationFallback(spec);
  assert.ok(d);
  assert.match(d.reason, /narrowed topic/i);
  assert.deepEqual(d.patch, [{ op: "replace", path: "/topic_tags", value: ["a", "b", "c"] }]);
});
