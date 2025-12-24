import type { SpecDraft } from "../compiler/specDraft";
import { computeReadiness, type ConfidenceMap } from "./readiness";
import type { CommitmentStore } from "./commitments";
import { selectNextGoal } from "./conversationGoals";

/**
 * Stable identifier for "what question are we currently trying to answer?"
 * Used to decide whether to keep buffering messages or reset the buffer.
 */
export function getDynamicQuestionKey(
  spec: SpecDraft,
  confidence: ConfidenceMap | null | undefined,
  commitments?: CommitmentStore | null
): string | null {
  const readiness = computeReadiness(spec, confidence, commitments ?? undefined);
  if (readiness.ready) return "ready";

  if (readiness.gaps.complete && readiness.lowConfidenceFields.length > 0) {
    return `confirm:${readiness.lowConfidenceFields.map(String).sort().join(",")}`;
  }

  const invalidKeys = Object.keys(readiness.gaps.invalid);
  if (invalidKeys.length > 0) return `invalid:${invalidKeys[0]}`;

  const nextGoal = selectNextGoal({ spec, gaps: readiness.gaps, commitments: commitments ?? null });
  if (nextGoal) return `goal:${nextGoal}`;

  return null;
}
