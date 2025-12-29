require("../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { adjustNeedsConfirmationFields } = require("../../../src/services/confirmationFlow");

test("confirmationFlow: suppresses re-confirming the same pending field", () => {
  const out = adjustNeedsConfirmationFields({
    needsConfirmationFields: ["problem_count"],
    currentQuestionKey: "confirm:problem_count",
    pending: { kind: "pending_confirmation", fields: ["problem_count"], patch: { problem_count: 4 } },
    deterministicPatch: {},
    deterministicDifficultyExplicitTotal: false,
  });
  assert.deepEqual(out, []);
});

test("confirmationFlow: treats explicit difficulty shorthand total as explicit problem_count too", () => {
  const out = adjustNeedsConfirmationFields({
    needsConfirmationFields: ["problem_count", "difficulty_plan"],
    currentQuestionKey: null,
    pending: null,
    deterministicPatch: {
      problem_count: 4,
      difficulty_plan: [
        { difficulty: "easy", count: 2 },
        { difficulty: "medium", count: 2 },
      ],
    },
    deterministicDifficultyExplicitTotal: true,
  });
  assert.deepEqual(out, []);
});

test("confirmationFlow: removes difficulty_plan when deterministic patch provides it (even if total not explicit)", () => {
  const out = adjustNeedsConfirmationFields({
    needsConfirmationFields: ["difficulty_plan", "problem_count"],
    currentQuestionKey: null,
    pending: null,
    deterministicPatch: { difficulty_plan: [{ difficulty: "easy", count: 4 }] },
    deterministicDifficultyExplicitTotal: false,
  });
  assert.deepEqual(out, ["problem_count"]);
});

test("confirmationFlow: keeps problem_count when difficulty shorthand total is not explicit", () => {
  const out = adjustNeedsConfirmationFields({
    needsConfirmationFields: ["problem_count"],
    currentQuestionKey: null,
    pending: null,
    deterministicPatch: { problem_count: 4, difficulty_plan: [{ difficulty: "easy", count: 4 }] },
    deterministicDifficultyExplicitTotal: false,
  });
  assert.deepEqual(out, ["problem_count"]);
});

test("confirmationFlow: does not suppress when question key is not a confirm key", () => {
  const out = adjustNeedsConfirmationFields({
    needsConfirmationFields: ["problem_count"],
    currentQuestionKey: "ask:problem_count",
    pending: { kind: "pending_confirmation", fields: ["problem_count"], patch: { problem_count: 4 } },
    deterministicPatch: {},
    deterministicDifficultyExplicitTotal: false,
  });
  assert.deepEqual(out, ["problem_count"]);
});
