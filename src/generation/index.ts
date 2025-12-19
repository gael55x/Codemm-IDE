import type { ProblemPlan } from "../planner/types";
import type { GeneratedProblem, GeneratedProblemDraft } from "../contracts/problem";
import { generateSingleProblem } from "./perSlotGenerator";
import {
  ReferenceSolutionValidationError,
  validateReferenceSolution,
} from "./referenceSolutionValidator";
import { trace } from "../utils/trace";
import { GenerationContractError, GenerationSlotFailureError, type GenerationFailureKind } from "./errors";
import type { GenerationProgressEvent } from "../contracts/generationProgress";

/**
 * Discard reference_solution from GeneratedProblemDraft to produce GeneratedProblem.
 *
 * CRITICAL: reference_solution MUST NOT be persisted to the database.
 */
function discardReferenceArtifacts(draft: GeneratedProblemDraft): GeneratedProblem {
  if ("reference_solution" in draft) {
    const { reference_solution, ...rest } = draft;
    return rest;
  }
  const { reference_workspace, ...rest } = draft;
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
export async function generateProblemsFromPlan(
  plan: ProblemPlan,
  opts?: { onProgress?: (event: GenerationProgressEvent) => void }
): Promise<GeneratedProblem[]> {
  const problems: GeneratedProblem[] = [];
  const maxAttempts = 3;
  const onProgress = opts?.onProgress;

  for (const slot of plan) {
    onProgress?.({ type: "problem_started", index: slot.index, difficulty: slot.difficulty });
    trace("generation.slot.plan", {
      slotIndex: slot.index,
      difficulty: slot.difficulty,
      topics: slot.topics,
      language: slot.language,
      problemStyle: slot.problem_style,
    });

    let problem: GeneratedProblem | null = null;
    let attempts = 0;
    let lastError: Error | null = null;
    let lastDraft: GeneratedProblemDraft | null = null;
    let lastLlmOutputHash: string | undefined;
    let repair:
      | {
          previousDraft?: GeneratedProblemDraft;
          previousRaw?: string;
          errorMessage?: string;
          judgeStdout?: string;
          judgeStderr?: string;
        }
      | undefined;

    while (!problem && attempts < maxAttempts) {
      attempts++;
      try {
        trace("generation.attempt.start", { slotIndex: slot.index, attempts });
        onProgress?.({ type: "attempt_started", index: slot.index, attempt: attempts });
        // Step 1: Generate single problem via LLM (includes reference_solution)
        const generated = await generateSingleProblem(slot, repair ? { repair } : undefined);
        const draft: GeneratedProblemDraft = generated.draft;
        lastDraft = draft;
        lastLlmOutputHash = generated.meta.llmOutputHash;

        // Step 2: Validate reference_solution compiles and passes tests (Docker)
        onProgress?.({ type: "validation_started", index: slot.index, attempt: attempts });
        await validateReferenceSolution(draft);

        // Step 3: Discard reference_solution (CRITICAL: do not persist)
        problem = discardReferenceArtifacts(draft);
        onProgress?.({ type: "problem_validated", index: slot.index });
        trace("generation.attempt.success", { slotIndex: slot.index, attempts, title: draft.title });
      } catch (err: any) {
        lastError = err;
        console.warn(
          `Slot ${slot.index} generation attempt ${attempts}/${maxAttempts} failed:`,
          err.message
        );

        if (err instanceof GenerationContractError) {
          onProgress?.({ type: "attempt_failed", index: slot.index, attempt: attempts, phase: "generate" });
          lastLlmOutputHash = err.llmOutputHash ?? lastLlmOutputHash;
          repair = {
            ...(typeof err.rawSnippet === "string" ? { previousRaw: err.rawSnippet } : {}),
            ...(typeof err.message === "string" && err.message ? { errorMessage: err.message } : {}),
          };
        }

        if (err instanceof ReferenceSolutionValidationError && lastDraft) {
          onProgress?.({ type: "validation_failed", index: slot.index, attempt: attempts });
          onProgress?.({ type: "attempt_failed", index: slot.index, attempt: attempts, phase: "validate" });
          repair = {
            previousDraft: lastDraft,
            judgeStdout: err.judgeStdout,
            judgeStderr: err.judgeStderr,
            errorMessage: err.message,
          };
          trace("generation.attempt.repair", { slotIndex: slot.index, attempts, exitCode: err.exitCode });
        } else {
          if (!(err instanceof GenerationContractError)) {
            onProgress?.({ type: "attempt_failed", index: slot.index, attempt: attempts, phase: "generate" });
            repair = undefined;
          }
        }

        if (attempts >= maxAttempts) {
          onProgress?.({ type: "problem_failed", index: slot.index });
          const kind: GenerationFailureKind =
            err instanceof ReferenceSolutionValidationError
              ? err.kind
              : err instanceof GenerationContractError
              ? "contract"
              : /Invalid test_suite|schema validation|public class|Test suite class name/i.test(String(err?.message))
              ? "contract"
              : "unknown";
          throw new GenerationSlotFailureError(
            `Failed to generate slot ${slot.index} after ${maxAttempts} attempts. Last error: ${err.message}`,
            {
              slotIndex: slot.index,
              kind,
              attempts: maxAttempts,
              ...(typeof lastDraft?.title === "string" ? { title: lastDraft.title } : {}),
              ...(typeof lastLlmOutputHash === "string" ? { llmOutputHash: lastLlmOutputHash } : {}),
            }
          );
        }
        // Retry
      }
    }

    if (!problem) {
      throw new Error(
        `Failed to generate slot ${slot.index}. Last error: ${lastError?.message ?? "unknown"}`
      );
    }

    problems.push(problem);
  }

  return problems;
}
