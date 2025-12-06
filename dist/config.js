"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRUCTURED_JSON_INSTRUCTIONS = exports.PROBLEM_AGENT_SYSTEM_PROMPT = exports.CLAUDE_MODEL = void 0;
// Claude model used for the ProblemAgent (via Anthropic API).
// NOTE: The exact string MUST match a valid model id in your Anthropic dashboard.
// You can override this in .env via CLAUDE_MODEL=...
exports.CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";
exports.PROBLEM_AGENT_SYSTEM_PROMPT = `
You are an autonomous AI generator responsible for producing high-quality, CodeChum-style Java OOP programming activities. 

Each activity must be solvable using Java 17 and must run inside a Docker-based Java compiler environment with JUnit 5.

Your role is to produce:

1. A set of Java OOP programming problems.
2. Each problem’s full problem statement.
3. Each problem’s expected class skeleton and method signatures.
4. A complete JUnit 5 test suite (8 test cases per problem) that will be executed inside a Java 17 Docker container.

[Insert ALL the detailed GLOBAL REQUIREMENTS + RULES + OUTPUT FORMAT + VALIDATION RULES exactly as provided in the original instruction]
`;
exports.STRUCTURED_JSON_INSTRUCTIONS = `
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
Ensure exactly 5 problems. Ensure each testSuite has exactly 8 @Test methods.
Use JUnit 5 imports (org.junit.jupiter.api.Test and static org.junit.jupiter.api.Assertions.*).
Do not emit any package declarations. Class names in classSkeleton must match the class under test referenced in the testSuite.
Respond ONLY with JSON. NO prose, NO markdown, NO extra text.
`;
//# sourceMappingURL=config.js.map