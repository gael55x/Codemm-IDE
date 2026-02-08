import type { ProblemSlot } from "../../planner/types";
import type { SlotPromptContext } from "../types";

export const CPP_V1_GENERATOR_SYSTEM_PROMPT = `
You are Codemm's C++ problem generator. Generate exactly 1 C++ problem that matches the provided requirements.

C++ invariants (non-negotiable):
- C++20 (g++)
- Standard library only (no external libraries)
- No filesystem access
- No networking
- Deterministic behavior (no randomness unless explicitly required)
- No stdin reads (do not use cin/scanf/getline/etc); prefer pure functions

Problem quality rules (non-negotiable):
- The description, tests, and reference_solution must describe and validate the SAME behavior.
- Do NOT prescribe a specific algorithm unless it is guaranteed correct for all valid inputs.
  (Example pitfall: "coin change with greedy" is not correct for arbitrary denominations.)
- Prefer describing required behavior and constraints, then implement a correct reference_solution.
- You MUST #include <functional> if you use std::function.
- You MUST #include <algorithm> if you use std::sort, std::max, etc.
- You MUST #include <numeric> if you use std::accumulate.
- You MUST #include <sstream> if you use std::stringstream.



Solution interface:
- Provide a single entry function named solve(...)
- solve(...) MUST be deterministic and must NOT read from stdin
- The required output behavior depends on Problem style:
  - return: solve(...) returns the answer (no printing)
  - stdout: solve(...) prints the answer to std::cout (tests capture stdout)
  - mixed: solve(...) returns the answer AND prints it to std::cout
- Do not define main() in solution.cpp

Test suite requirements (custom runner in test.cpp):
- Must #include "solution.cpp"
- Must define a main() test runner
- Exactly 8 tests, named: test_case_1 ... test_case_8
- Use this exact harness template (copy/paste; only edit inside the TODO blocks):
  static int __codem_failures = 0;
  #define RUN_TEST(name, ...) do { \\
    try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\\\n"; } \\
    catch (const std::exception& e) { std::cout << "[FAIL] " << (name) << "\\\\n"; __codem_failures++; } \\
    catch (...) { std::cout << "[FAIL] " << (name) << "\\\\n"; __codem_failures++; } \\
  } while (0)

  int main() {
    RUN_TEST("test_case_1", { /* TODO */ });
    RUN_TEST("test_case_2", { /* TODO */ });
    RUN_TEST("test_case_3", { /* TODO */ });
    RUN_TEST("test_case_4", { /* TODO */ });
    RUN_TEST("test_case_5", { /* TODO */ });
    RUN_TEST("test_case_6", { /* TODO */ });
    RUN_TEST("test_case_7", { /* TODO */ });
    RUN_TEST("test_case_8", { /* TODO */ });
    return __codem_failures ? 1 : 0;
  }
- Print a single line per test in this exact format:
  [PASS] test_case_1
  [FAIL] test_case_1

Output format:
- Return ONLY valid JSON (no markdown, no code fences, no prose)
- Return a JSON object for a SINGLE problem (not an array)
`.trim();

export function buildCppSlotPrompt(slot: ProblemSlot, ctx?: SlotPromptContext): string {
  const topicsText = slot.topics.join(", ");
  const style =
    slot.problem_style === "stdout" || slot.problem_style === "mixed" || slot.problem_style === "return"
      ? slot.problem_style
      : "return";
  const styleRules =
    style === "stdout"
      ? `- reference_solution should write the final answer to std::cout (not stdin)\n- test_suite must capture std::cout (redirect rdbuf to std::ostringstream) and compare printed output`
      : style === "mixed"
        ? `- reference_solution should return the answer AND print it to std::cout\n- test_suite must compare BOTH the returned value and captured std::cout output`
        : `- reference_solution must return the answer (no printing)\n- test_suite must compare returned values only (no stdout capture)`;
  const custom = typeof ctx?.customInstructionsMd === "string" ? ctx.customInstructionsMd.trim() : "";
  const customBlock = custom ? `\nCustom instructions (user focus; best-effort):\n${custom}\n` : "";

  return `Generate exactly 1 C++ problem with the following requirements:

Difficulty: ${slot.difficulty}
Topics: ${topicsText}
Problem style: ${slot.problem_style}
Constraints: ${slot.constraints}
${customBlock}

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
- test_suite MUST include this exact harness pattern (do not change signature):
  static int __codem_failures = 0;
  #define RUN_TEST(name, ...) do { \\
    try { __VA_ARGS__; std::cout << "[PASS] " << (name) << "\\\\n"; } \\
    catch (const std::exception& e) { std::cout << "[FAIL] " << (name) << "\\\\n"; __codem_failures++; } \\
    catch (...) { std::cout << "[FAIL] " << (name) << "\\\\n"; __codem_failures++; } \\
  } while (0)
  int main(){ ... return __codem_failures ? 1 : 0; }
- test_suite must call RUN_TEST exactly 8 times: test_case_1..test_case_8
- solve(...) must NOT read from stdin (no cin/scanf/getline/etc)
	${styleRules}
	- Tests must print exactly one status line per test: [PASS] test_case_N or [FAIL] test_case_N
	- No randomness, no flaky behavior
	- Keep test inputs small enough to run comfortably under strict time limits (avoid massive graphs/arrays).
	- sample_inputs and sample_outputs MUST be non-empty and must have the same length (at least 1).

	Respond ONLY with JSON. NO markdown. NO code fences. NO extra text.`;
	}
