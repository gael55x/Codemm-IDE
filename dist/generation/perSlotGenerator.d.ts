import { type GeneratedProblemDraft } from "../contracts/problem";
import type { ProblemSlot } from "../planner/types";
/**
 * Generate a single problem for the given slot via one Anthropic LLM call.
 *
 * Returns GeneratedProblemDraft (includes reference_solution).
 * Validates JSON shape and test suite structure.
 * Does NOT validate reference solution via Docker (that's the next step).
 * Does NOT retry (caller handles retries).
 *
 * Throws on any validation failure.
 */
export declare function generateSingleProblem(slot: ProblemSlot): Promise<GeneratedProblemDraft>;
//# sourceMappingURL=perSlotGenerator.d.ts.map