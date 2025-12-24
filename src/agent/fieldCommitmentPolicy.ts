import type { SpecDraft } from "../compiler/specDraft";
import type { UserEditableSpecKey } from "./dialogue";

const HARD_FIELDS: readonly UserEditableSpecKey[] = ["language", "problem_count", "difficulty_plan"];

function isTruthyString(v: unknown): v is string {
  return typeof v === "string" && Boolean(v.trim());
}

function parseExplicitLanguage(userMessage: string): "java" | "python" | "cpp" | "sql" | null {
  const msg = userMessage.toLowerCase();
  if (/\bsql\b/.test(msg) || /\bsqlite\b/.test(msg)) return "sql";
  // Avoid \b...\b for "c++" because "+" isn't a word char (word-boundary won't match).
  if (/(^|[^a-z0-9])c\+\+([^a-z0-9]|$)/.test(msg) || /\bcpp\b/.test(msg)) return "cpp";
  if (/\bpython\b/.test(msg)) return "python";
  if (/\bjava\b/.test(msg)) return "java";
  return null;
}

function hasExplicitProblemCount(userMessage: string): boolean {
  const msg = userMessage.trim().toLowerCase();
  if (/^(?:i want )?\d+\b/.test(msg)) return true;
  return /(\b\d+\b)\s*(problems|problem|questions|question|exercises|exercise)\b/.test(msg);
}

function hasExplicitDifficultyPlan(userMessage: string): boolean {
  const msg = userMessage.toLowerCase();
  if (/\b(easy|medium|hard)\b/.test(msg)) return true;
  return /\b(easy|medium|hard)\s*:\s*\d+\b/.test(msg);
}

export type ConfirmRequiredEvent = {
  kind: "confirm_required";
  fields: UserEditableSpecKey[];
  candidatePatch: Record<string, unknown>;
  reason: "implicit";
};

export function computeConfirmRequired(args: {
  userMessage: string;
  currentSpec: SpecDraft;
  inferredPatch: Record<string, unknown>;
}): { required: false } | { required: true; fields: UserEditableSpecKey[]; event: ConfirmRequiredEvent } {
  const fields: UserEditableSpecKey[] = [];

  // language: never silently switch away from existing language
  if (Object.prototype.hasOwnProperty.call(args.inferredPatch, "language")) {
    const nextLang = args.inferredPatch["language"];
    if (isTruthyString(nextLang) && nextLang !== args.currentSpec.language) {
      const hasExisting = isTruthyString(args.currentSpec.language);
      if (hasExisting) {
        const explicit = parseExplicitLanguage(args.userMessage);
        if (!explicit) fields.push("language");
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(args.inferredPatch, "problem_count")) {
    const nextCount = args.inferredPatch["problem_count"];
    const changed =
      typeof nextCount === "number" &&
      (typeof args.currentSpec.problem_count !== "number" || args.currentSpec.problem_count !== nextCount);
    if (changed && !hasExplicitProblemCount(args.userMessage)) fields.push("problem_count");
  }

  if (Object.prototype.hasOwnProperty.call(args.inferredPatch, "difficulty_plan")) {
    const nextPlan = args.inferredPatch["difficulty_plan"];
    const changed = Array.isArray(nextPlan) && nextPlan.length > 0;
    if (changed && !hasExplicitDifficultyPlan(args.userMessage)) fields.push("difficulty_plan");
  }

  const uniq = Array.from(new Set(fields)).filter((f) => HARD_FIELDS.includes(f));
  if (uniq.length === 0) return { required: false };

  return {
    required: true,
    fields: uniq,
    event: {
      kind: "confirm_required",
      fields: uniq,
      candidatePatch: args.inferredPatch,
      reason: "implicit",
    },
  };
}
