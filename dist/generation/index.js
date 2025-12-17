"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateProblemsFromPlan = generateProblemsFromPlan;
const perSlotGenerator_1 = require("./perSlotGenerator");
const referenceSolutionValidator_1 = require("./referenceSolutionValidator");
const trace_1 = require("../utils/trace");
/**
 * Discard reference_solution from GeneratedProblemDraft to produce GeneratedProblem.
 *
 * CRITICAL: reference_solution MUST NOT be persisted to the database.
 */
function discardReferenceSolution(draft) {
    const { reference_solution, ...rest } = draft;
    return rest;
}
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
async function generateProblemsFromPlan(plan) {
    const problems = [];
    const maxAttempts = 3;
    for (const slot of plan) {
        (0, trace_1.trace)("generation.slot.plan", {
            slotIndex: slot.index,
            difficulty: slot.difficulty,
            topics: slot.topics,
            language: slot.language,
            problemStyle: slot.problem_style,
        });
        let problem = null;
        let attempts = 0;
        let lastError = null;
        let lastDraft = null;
        let repair;
        while (!problem && attempts < maxAttempts) {
            attempts++;
            try {
                (0, trace_1.trace)("generation.attempt.start", { slotIndex: slot.index, attempts });
                // Step 1: Generate single problem via LLM (includes reference_solution)
                const draft = await (0, perSlotGenerator_1.generateSingleProblem)(slot, repair ? { repair } : undefined);
                lastDraft = draft;
                // Step 2: Validate reference_solution compiles and passes tests (Docker)
                await (0, referenceSolutionValidator_1.validateReferenceSolution)(draft);
                // Step 3: Discard reference_solution (CRITICAL: do not persist)
                problem = discardReferenceSolution(draft);
                (0, trace_1.trace)("generation.attempt.success", { slotIndex: slot.index, attempts, title: draft.title });
            }
            catch (err) {
                lastError = err;
                console.warn(`Slot ${slot.index} generation attempt ${attempts}/${maxAttempts} failed:`, err.message);
                if (err instanceof referenceSolutionValidator_1.ReferenceSolutionValidationError && lastDraft) {
                    repair = {
                        previousDraft: lastDraft,
                        judgeStdout: err.judgeStdout,
                        judgeStderr: err.judgeStderr,
                    };
                    (0, trace_1.trace)("generation.attempt.repair", { slotIndex: slot.index, attempts, exitCode: err.exitCode });
                }
                else {
                    repair = undefined;
                }
                if (attempts >= maxAttempts) {
                    throw new Error(`Failed to generate slot ${slot.index} after ${maxAttempts} attempts. Last error: ${err.message}`);
                }
                // Retry
            }
        }
        if (!problem) {
            throw new Error(`Failed to generate slot ${slot.index}. Last error: ${lastError?.message ?? "unknown"}`);
        }
        problems.push(problem);
    }
    return problems;
}
//# sourceMappingURL=index.js.map