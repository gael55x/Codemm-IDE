import type { ProblemSlot } from "../../planner/types";
import type { SlotPromptContext } from "../types";

export const PYTHON_V1_GENERATOR_SYSTEM_PROMPT = `
You are Codemm's Python problem generator. Generate exactly 1 Python problem that matches the provided requirements.

Python invariants (non-negotiable):
- Python 3.11 only
- Standard library only (no external libraries)
- No filesystem access (do not read/write files)
- No networking
- Deterministic behavior (no randomness unless explicitly required)
- No stdin reads (do not use input() or sys.stdin.*); prefer pure functions

Test suite requirements (pytest):
- Tests MUST use pytest style: plain functions with assert statements
- Exactly 8 test functions named: test_case_1 ... test_case_8
- Tests MUST NOT print, read input(), or use randomness
- No floating-point tolerance unless the problem explicitly defines it (do not use pytest.approx)

Solution interface:
- Provide a single entry function named solve(...)
- solve(...) MUST be deterministic and must NOT read from stdin
- The required output behavior depends on Problem style:
  - return: solve(...) returns the answer (no printing)
  - stdout: solve(...) prints the answer to stdout (tests capture stdout)
  - mixed: solve(...) returns the answer AND prints it to stdout

Output format:
- Return ONLY valid JSON (no markdown, no code fences, no prose)
- Return a JSON object for a SINGLE problem (not an array)
`.trim();

export function buildPythonSlotPrompt(slot: ProblemSlot, ctx?: SlotPromptContext): string {
  const topicsText = slot.topics.join(", ");
  const style = slot.problem_style === "stdout" || slot.problem_style === "mixed" || slot.problem_style === "return" ? slot.problem_style : "return";
  const styleRules =
    style === "stdout"
      ? `- solve(...) should print the final answer to stdout and return None\n- test_suite must use capsys.readouterr() and assert on captured.out`
      : style === "mixed"
        ? `- solve(...) should return the answer AND print it to stdout\n- test_suite must assert solve(...) == expected AND assert captured.out`
        : `- solve(...) must return the answer (no printing)\n- test_suite must assert solve(...) == expected`;
  const custom = typeof ctx?.customInstructionsMd === "string" ? ctx.customInstructionsMd.trim() : "";
  const customBlock = custom ? `\nCustom instructions (user focus; best-effort):\n${custom}\n` : "";

  return `Generate exactly 1 Python problem with the following requirements:

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
	  "starter_code": "def solve(...):\\n    # TODO\\n    pass\\n",
	  "test_suite": "import pytest\\nfrom solution import solve\\n\\n...\\n",
	  "reference_solution": "def solve(...):\\n    ...\\n",
	  "constraints": "${slot.constraints}",
	  "sample_inputs": ["input1", "input2"],
	  "sample_outputs": ["output1", "output2"],
	  "difficulty": "${slot.difficulty}",
	  "topic_tag": "${slot.topics[0] ?? "oop"}"
	}

Critical rules:
- starter_code and reference_solution must define solve(...)
- solve(...) must NOT read from stdin (no input(), no sys.stdin.*)
${styleRules}
- test_suite must import solve via: from solution import solve
- test_suite must define exactly 8 tests named test_case_1..test_case_8
	- No print-based tests; use assertions only (stdout style captures via capsys)
	- No randomness, no pytest.approx, no flaky behavior
	- Keep test inputs small enough to run comfortably under strict time limits (avoid huge loops/recursion depth).
	- Ensure generated JSON strings are properly escaped (especially backslashes and quotes).
	- sample_inputs and sample_outputs MUST be non-empty and must have the same length (at least 1).

	Respond ONLY with JSON. NO markdown. NO code fences. NO extra text.`;
	}
