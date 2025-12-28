require("ts-node/register");

const test = require("node:test");
const assert = require("node:assert/strict");

const { adjustNeedsConfirmationFields } = require("../src/services/confirmationFlow");

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

