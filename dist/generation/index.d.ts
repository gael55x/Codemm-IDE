import type { ProblemPlan } from "../planner/types";
import type { GeneratedProblem } from "../contracts/problem";
import type { GenerationProgressEvent } from "../contracts/generationProgress";
/**
 * Generate problems from a ProblemPlan using per-slot generation with isolated retries.
 *
 * For each slot:
 * - Call LLM to generate GeneratedProblemDraft (includes reference_solution)
 * - Validate reference_solution via Docker (compiles + passes tests)
 * - Discard reference_solution
 * - Collect GeneratedProblem
 *
 * Retry each slot up to 3 times on failure.
 * Throw if any slot fails after max retries.
 */
export declare function generateProblemsFromPlan(plan: ProblemPlan, opts?: {
    onProgress?: (event: GenerationProgressEvent) => void;
}): Promise<GeneratedProblem[]>;
//# sourceMappingURL=index.d.ts.map