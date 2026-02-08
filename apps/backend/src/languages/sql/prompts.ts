import type { ProblemSlot } from "../../planner/types";
import type { SlotPromptContext } from "../types";

export const SQL_V1_GENERATOR_SYSTEM_PROMPT = `
You are Codemm's SQL problem generator. Generate exactly 1 SQL problem that matches the provided requirements.

SQL runtime invariants (non-negotiable):
- SQLite 3 dialect
- The learner writes a single read-only query (WITH/SELECT only)
- No schema changes or mutations in the solution query
- Deterministic results: include ORDER BY if row order matters

Test suite format (JSON string):
- test_suite MUST be valid JSON (not code)
- It MUST include:
  - schema_sql: SQL statements that create tables (CREATE TABLE ...)
  - cases: exactly 8 cases named test_case_1..test_case_8
    each case includes:
      - seed_sql: SQL inserts for that case
      - expected: { columns: string[], rows: any[][] }
      - order_matters?: boolean

Output format:
- Return ONLY valid JSON (no markdown, no code fences, no prose)
- Return a JSON object for a SINGLE problem (not an array)
`.trim();

export function buildSqlSlotPrompt(slot: ProblemSlot, ctx?: SlotPromptContext): string {
  const topicsText = slot.topics.join(", ");
  const custom = typeof ctx?.customInstructionsMd === "string" ? ctx.customInstructionsMd.trim() : "";
  const customBlock = custom ? `\nCustom instructions (user focus; best-effort):\n${custom}\n` : "";

  return `Generate exactly 1 SQL (SQLite) problem with the following requirements:

Difficulty: ${slot.difficulty}
Topics: ${topicsText}
Problem style: ${slot.problem_style}
Constraints: ${slot.constraints}
${customBlock}

Return a JSON object (not array) with these exact fields:
{
  "id": "unique-problem-id",
  "title": "Problem Title",
  "description": "Detailed problem description (include table schema description in prose)...",
  "starter_code": "SELECT ...",
  "test_suite": "{\\n  \\\"schema_sql\\\": \\\"...\\\",\\n  \\\"cases\\\": [ ... ]\\n}",
  "reference_solution": "SELECT ...",
  "constraints": "${slot.constraints}",
  "sample_inputs": ["Example 1 input (describe relevant table rows for the sample case)", "Example 2 input (...)"],
  "sample_outputs": ["Example 1 output (show expected query result table)", "Example 2 output (...)"],
  "difficulty": "${slot.difficulty}",
  "topic_tag": "${slot.topics[0] ?? "oop"}"
}

Critical rules:
- starter_code and reference_solution must be a single read-only query (WITH/SELECT only)
- test_suite must be valid JSON with schema_sql + exactly 8 cases: test_case_1..test_case_8
- Each case object must look like: { "name": "test_case_N", "seed_sql": "...", "expected": { "columns": ["col"], "rows": [[val]] } }
- Ensure "cases" is an array of 8 objects.
- Ensure "expected" matches the query columns/rows exactly.
- If order matters, set order_matters=true and include ORDER BY in the solution query.
- sample_inputs and sample_outputs MUST be non-empty and must have the same length (at least 1).

Respond ONLY with JSON. NO markdown. NO code fences. NO extra text.`;

}
