import type { GeneratedProblemDraft } from "../contracts/problem";
export declare class ReferenceSolutionValidationError extends Error {
    judgeStdout: string;
    judgeStderr: string;
    exitCode: number | undefined;
    constructor(message: string, opts: {
        stdout: string;
        stderr: string;
        exitCode?: number;
    });
}
/**
 * Validate that the reference_solution compiles and passes all tests via Docker.
 *
 * Throws on:
 * - Compile errors
 * - Test failures (reference solution must pass all tests)
 *
 * Returns void on success.
 *
 * After this validation passes, the caller MUST discard reference_solution
 * before persisting the problem.
 */
export declare function validateReferenceSolution(draft: GeneratedProblemDraft): Promise<void>;
//# sourceMappingURL=referenceSolutionValidator.d.ts.map