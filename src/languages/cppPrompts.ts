import type { ProblemSlot } from "../planner/types";

export const CPP_V1_GENERATOR_SYSTEM_PROMPT = `
You are Codemm's C++ problem generator. Generate exactly 1 C++ problem that matches the provided requirements.

C++ invariants (non-negotiable):
- C++20 (g++)
- Standard library only (no external libraries)
- No filesystem access
- No networking
- Deterministic behavior (no randomness unless explicitly required)
- No I/O unless explicitly specified (prefer pure functions)

Solution interface:
- Provide a single entry function named solve(...)
- solve(...) MUST return a value deterministically
- Do not read from stdin or print from solve()
- Do not define main() in solution.cpp

Test suite requirements (custom runner in test.cpp):
- Must #include "solution.cpp"
- Must define a main() test runner
- Exactly 8 tests, named: test_case_1 ... test_case_8
- Use the macro form: RUN_TEST("test_case_1", { ... });
- Print a single line per test in this exact format:
  [PASS] test_case_1
  [FAIL] test_case_1

Output format:
- Return ONLY valid JSON (no markdown, no code fences, no prose)
- Return a JSON object for a SINGLE problem (not an array)
`.trim();

export function buildCppSlotPrompt(slot: ProblemSlot): string {
  const topicsText = slot.topics.join(", ");

  return `Generate exactly 1 C++ problem with the following requirements:

Difficulty: ${slot.difficulty}
Topics: ${topicsText}
Problem style: ${slot.problem_style}
Constraints: ${slot.constraints}

Return a JSON object (not array) with these exact fields:
{
  "id": "unique-problem-id",
  "title": "Problem Title",
  "description": "Detailed problem description...",
  "starter_code": "#include <bits/stdc++.h>\\n\\n// Implement solve(...) below.\\n",
  "test_suite": "#include <bits/stdc++.h>\\n#include \\\"solution.cpp\\\"\\n\\n...\\n",
  "reference_solution": "#include <bits/stdc++.h>\\n\\n// solve(...)\\n",
  "constraints": "${slot.constraints}",
  "sample_inputs": ["input1", "input2"],
  "sample_outputs": ["output1", "output2"],
  "difficulty": "${slot.difficulty}",
  "topic_tag": "${slot.topics[0] ?? "oop"}"
}

Critical rules:
- starter_code and reference_solution must define solve(...) (no main())
- test_suite must #include "solution.cpp"
- test_suite must define exactly 8 RUN_TEST("test_case_1".."test_case_8", ...) tests
- Each test must assert solve(...) == expected (no print-based tests)
- Tests must print exactly one status line per test: [PASS] test_case_N or [FAIL] test_case_N
- No randomness, no flaky behavior

Respond ONLY with JSON. NO markdown. NO code fences. NO extra text.`;
}

