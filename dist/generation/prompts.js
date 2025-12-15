"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.V1_PROBLEM_GENERATOR_SYSTEM_PROMPT = void 0;
exports.buildSlotPrompt = buildSlotPrompt;
exports.V1_PROBLEM_GENERATOR_SYSTEM_PROMPT = `
You are Codemm's Java problem generator. Generate exactly 1 Java OOP problem that matches the provided requirements.

Hard requirements:
- Java 17, no package declarations anywhere.
- Return JSON for a SINGLE problem (not an array).
- Include these exact fields:
  * id (string)
  * title (string)
  * description (string)
  * starter_code (Java class skeleton with method signatures, no implementation)
  * test_suite (JUnit 5 test class with exactly 8 @Test methods)
  * reference_solution (complete working Java class that passes all tests)
  * constraints (string)
  * sample_inputs (array of strings)
  * sample_outputs (array of strings)
  * difficulty (easy | medium | hard)
  * topic_tag (string)

Test suite requirements:
- Exactly 8 @Test methods
- Import org.junit.jupiter.api.Test and static org.junit.jupiter.api.Assertions.*
- No package declarations
- Test class name must match starter_code class name + "Test"
- Tests must assert real behavior (no assertTrue(true) placeholders)
- Use assertEquals/assertTrue/assertFalse/assertThrows with meaningful expectations

Reference solution requirements:
- Must be a complete, working implementation
- Must compile without errors
- Must pass all 8 test cases
- Same class name as starter_code
- No package declarations

Return ONLY valid JSON. No markdown, no code fences, no prose.
`;
function buildSlotPrompt(slot) {
    const topicsText = slot.topics.join(", ");
    return `Generate exactly 1 Java OOP problem with the following requirements:

Difficulty: ${slot.difficulty}
Topics: ${topicsText}
Problem style: ${slot.problem_style}
Constraints: ${slot.constraints}

Return a JSON object (not array) with these exact fields:
{
  "id": "unique-problem-id",
  "title": "Problem Title",
  "description": "Detailed problem description...",
  "starter_code": "public class ClassName { ... }",
  "test_suite": "import org.junit.jupiter.api.Test; ...",
  "reference_solution": "public class ClassName { /* complete implementation */ }",
  "constraints": "${slot.constraints}",
  "sample_inputs": ["input1", "input2"],
  "sample_outputs": ["output1", "output2"],
  "difficulty": "${slot.difficulty}",
  "topic_tag": "${slot.topics[0] ?? "oop"}"
}

Critical rules:
- test_suite must have exactly 8 @Test methods
- reference_solution must be a complete, working solution that passes all tests
- starter_code should be the same class with method signatures but TODOs instead of implementation
- All Java code must have NO package declarations
- Test class must import org.junit.jupiter.api.Test and static org.junit.jupiter.api.Assertions.*

Respond ONLY with JSON. NO markdown. NO code fences. NO extra text.`;
}
//# sourceMappingURL=prompts.js.map