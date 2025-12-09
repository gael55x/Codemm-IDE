// Claude model used for the ProblemAgent (via Anthropic API).
// NOTE: The exact string MUST match a valid model id in your Anthropic dashboard.
// You can override this in .env via CLAUDE_MODEL=...
export const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";

export const PROBLEM_AGENT_SYSTEM_PROMPT = `
You are Codem’s autonomous Java activity generator. Produce CodeChum-style Java OOP activities that can be graded automatically in Docker with JUnit 5.

Hard requirements for every problem:
- Java 17, no package declarations anywhere.
- Provide class skeleton with required method signatures and TODOs for the learner.
- Provide a complete JUnit 5 test suite with exactly 8 @Test methods.
- Tests must assert real behavior (no placeholders like assertTrue(true)), and must verify outputs/return values and/or stdout content (printf/userflow style). Use Assertions.assertEquals/contains, etc.
- Tests must import org.junit.jupiter.api.Test and static org.junit.jupiter.api.Assertions.* only.
- Test class must reference the class and methods defined in classSkeleton; names must match.
- Include sampleInputs and sampleOutputs that align with the test expectations.
- Do not include any prose/markdown outside the JSON payload.
`;

export interface GeneratedProblem {
  id: string;
  title: string;
  description: string;
  classSkeleton: string;
  testSuite: string;
  constraints: string;
  sampleInputs: string[];
  sampleOutputs: string[];
}

export interface JudgeResult {
  success: boolean;
  passedTests: string[];
  failedTests: string[];
  stdout: string;
  stderr: string;
  executionTimeMs: number;
}

export interface Activity {
  id: string;
  title: string;
  prompt: string;
  problems: GeneratedProblem[];
  createdAt: string;
}

export const STRUCTURED_JSON_INSTRUCTIONS = `
Return ONLY valid JSON. Do not include code fences, commentary, or markdown.
Format:
{
  "problems": [
    {
      "id": "string-uuid-or-slug",
      "title": "string",
      "description": "string",
      "classSkeleton": "string",
      "testSuite": "string",
      "constraints": "string",
      "sampleInputs": ["string"],
      "sampleOutputs": ["string"]
    }
  ]
}
Ensure exactly 5 problems. Each testSuite must have exactly 8 @Test methods with real assertions (no assertTrue(true) placeholders), using JUnit 5 imports (org.junit.jupiter.api.Test and static org.junit.jupiter.api.Assertions.*).
Tests must cover stdout/printf-style outputs or return values matching the described userflow. Use assertEquals/assertTrue/assertFalse/assertThrows with meaningful expectations.
Do not emit any package declarations. Class names in classSkeleton must match the class under test referenced in the testSuite.
Include method signatures students must implement in classSkeleton; do not implement the full solution.
Include sampleInputs and sampleOutputs that reflect the expected behavior and stdout shown in the tests.
Respond ONLY with JSON. NO prose, NO markdown, NO extra text.
`;


