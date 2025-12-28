import type { UserEditableSpecKey } from "../agent/dialogue";

export type PendingConfirmation = {
  kind: "pending_confirmation";
  fields: UserEditableSpecKey[];
  patch: Record<string, unknown>;
};

export function adjustNeedsConfirmationFields(args: {
  needsConfirmationFields: string[];
  currentQuestionKey: string | null;
  pending: PendingConfirmation | null;
  deterministicPatch: Record<string, unknown>;
  deterministicDifficultyExplicitTotal: boolean;
}): string[] {
  let out = Array.isArray(args.needsConfirmationFields) ? [...args.needsConfirmationFields] : [];

  // Deterministic parsing is treated as explicit; never force confirmation for difficulty_plan.
  if (Object.prototype.hasOwnProperty.call(args.deterministicPatch, "difficulty_plan")) {
    out = out.filter((f) => f !== "difficulty_plan");
  }

  // If difficulty shorthand implied an explicit total (e.g. "2 easy 2 medium"), treat the total as explicit too.
  if (
    args.deterministicDifficultyExplicitTotal &&
    Object.prototype.hasOwnProperty.call(args.deterministicPatch, "problem_count")
  ) {
    out = out.filter((f) => f !== "problem_count");
  }

  // If we're currently asking the user to confirm specific fields, don't keep re-asking for those same fields.
  const isConfirmKey = typeof args.currentQuestionKey === "string" && args.currentQuestionKey.startsWith("confirm:");
  if (isConfirmKey && args.pending && Array.isArray(args.pending.fields) && args.pending.fields.length > 0) {
    const pendingSet = new Set(args.pending.fields.map(String));
    out = out.filter((f) => !pendingSet.has(String(f)));
  }

  return out;
}

