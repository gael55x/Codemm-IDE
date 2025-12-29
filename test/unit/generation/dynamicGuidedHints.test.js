require("../../helpers/setupBase");

const test = require("node:test");
const assert = require("node:assert/strict");

const { applyGuidedScaffoldingAsync } = require("../../../src/generation/scaffolding");

test("guided scaffolding: injects dynamic hints (best-effort) into TODO block", async () => {
  process.env.CODEMM_DYNAMIC_GUIDED_HINTS = "1";

  let called = 0;
  const createCompletion = async () => {
    called++;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            hints: ["Track visited nodes to avoid cycles", "int solve(int n) { return 0; }"],
          }),
        },
      ],
    };
  };

  const reference_solution = `
#include <bits/stdc++.h>
int solve(int n) {
  return n + 1;
}
`.trim();

  const draft = {
    language: "cpp",
    id: "p",
    title: "Example",
    description: "Example description.",
    constraints: "Example constraints.",
    sample_inputs: [],
    sample_outputs: [],
    difficulty: "easy",
    topic_tag: "graphs",
    test_suite: "class Dummy {}",
    starter_code: reference_solution,
    reference_solution,
  };

  const slot = {
    index: 0,
    topics: ["graphs"],
    pedagogy: { scaffold_level: 0.9, learning_goal: "graphs", hints_enabled: true },
  };

  const out = await applyGuidedScaffoldingAsync(draft, slot, { deps: { createCompletion } });

  assert.equal(called, 1);
  assert.match(out.starter_code, /BEGIN STUDENT TODO/);
  assert.match(out.starter_code, /Hint: Track visited nodes to avoid cycles\./);
  assert.doesNotMatch(out.starter_code, /Hint:.*int solve/i);
});

test("guided scaffolding: does not call hint generator at low scaffold levels", async () => {
  process.env.CODEMM_DYNAMIC_GUIDED_HINTS = "1";

  let called = 0;
  const createCompletion = async () => {
    called++;
    return { content: [{ type: "text", text: "{\"hints\":[\"x\"]}" }] };
  };

  const reference_solution = `
#include <bits/stdc++.h>
int solve(int n) {
  return n + 1;
}
`.trim();

  const draft = {
    language: "cpp",
    id: "p",
    title: "Example",
    description: "Example description.",
    constraints: "Example constraints.",
    sample_inputs: [],
    sample_outputs: [],
    difficulty: "easy",
    topic_tag: "graphs",
    test_suite: "class Dummy {}",
    starter_code: reference_solution,
    reference_solution,
  };

  const slot = {
    index: 0,
    topics: ["graphs"],
    pedagogy: { scaffold_level: 0.1, learning_goal: "graphs", hints_enabled: true },
  };

  const out = await applyGuidedScaffoldingAsync(draft, slot, { deps: { createCompletion } });

  assert.equal(called, 0);
  assert.doesNotMatch(out.starter_code, /Hint:/);
});
