import type { ActivitySpec, Difficulty } from "../contracts/activitySpec";

type Counts = Record<Difficulty, number>;

function clampInt(n: number, min: number, max: number): number {
  const x = Math.trunc(n);
  return Math.max(min, Math.min(max, x));
}

function makeEmptyCounts(): Counts {
  return { easy: 0, medium: 0, hard: 0 };
}

function nonZeroDifficulties(c: Counts): Difficulty[] {
  const out: Difficulty[] = [];
  if (c.easy > 0) out.push("easy");
  if (c.medium > 0) out.push("medium");
  if (c.hard > 0) out.push("hard");
  return out;
}

function parseExplicitCounts(lower: string): Counts {
  const counts = makeEmptyCounts();

  // "easy:2", "medium x3", "hard=1"
  const a = /(easy|medium|hard)\s*(?:[:x=])\s*(\d+)\b/g;
  for (const m of lower.matchAll(a)) {
    const d = m[1] as Difficulty;
    const n = Number(m[2]);
    if (!Number.isFinite(n)) continue;
    counts[d] += clampInt(n, 0, 7);
  }

  // "2 easy", "3 medium"
  const b = /(\d+)\s*(easy|medium|hard)\b/g;
  for (const m of lower.matchAll(b)) {
    const n = Number(m[1]);
    const d = m[2] as Difficulty;
    if (!Number.isFinite(n)) continue;
    counts[d] += clampInt(n, 0, 7);
  }

  return counts;
}

function sumCounts(c: Counts): number {
  return c.easy + c.medium + c.hard;
}

function dominantDifficultyFromText(lower: string): Difficulty | null {
  const hasEasy = /\beasy\b/.test(lower);
  const hasMedium = /\bmedium\b/.test(lower);
  const hasHard = /\bhard\b/.test(lower);

  const hits = [hasEasy, hasMedium, hasHard].filter(Boolean).length;
  if (hits !== 1) return null;
  if (hasEasy) return "easy";
  if (hasMedium) return "medium";
  if (hasHard) return "hard";
  return null;
}

function coerceToMixedPlan(counts: Counts, total: number): Counts | null {
  const totalCount = clampInt(total, 1, 7);
  if (totalCount < 2) return null;

  const nz = nonZeroDifficulties(counts);
  if (nz.length >= 2) return counts;

  const only = nz[0] ?? "easy";
  const out = makeEmptyCounts();

  if (only === "easy") {
    out.easy = totalCount - 1;
    out.medium = 1;
    return out;
  }

  if (only === "hard") {
    out.hard = totalCount - 1;
    out.medium = 1;
    return out;
  }

  // medium-only
  if (totalCount === 2) {
    out.easy = 1;
    out.medium = 1;
    return out;
  }
  out.easy = 1;
  out.hard = 1;
  out.medium = totalCount - 2;
  return out;
}

function buildPlanArray(counts: Counts): Array<{ difficulty: Difficulty; count: number }> {
  const plan: Array<{ difficulty: Difficulty; count: number }> = [];
  if (counts.easy > 0) plan.push({ difficulty: "easy", count: counts.easy });
  if (counts.medium > 0) plan.push({ difficulty: "medium", count: counts.medium });
  if (counts.hard > 0) plan.push({ difficulty: "hard", count: counts.hard });
  return plan;
}

/**
 * Deterministically parses common shorthand difficulty answers into a contract-valid difficulty_plan.
 *
 * Note: Codemm's contract requires the plan be "mixed" (>=2 non-zero difficulties), so inputs like
 * "easy" or "easy:4" are interpreted as "easy overall" by producing a minimally-mixed plan.
 */
export function parseDifficultyPlanShorthand(args: {
  text: string;
  currentProblemCount?: number;
}): { patch: Partial<ActivitySpec>; explicitTotal: boolean } | null {
  const lower = args.text.trim().toLowerCase();
  if (!lower) return null;

  const countsFromPairs = parseExplicitCounts(lower);
  const pairSum = sumCounts(countsFromPairs);
  const hasPairs = pairSum > 0;

  const hasAnyDifficulty = /\b(easy|medium|hard)\b/.test(lower);
  if (!hasAnyDifficulty) return null;

  // If the user gave explicit per-difficulty counts, total is the sum.
  if (hasPairs) {
    if (pairSum < 1 || pairSum > 7) return null;
    const mixed = coerceToMixedPlan(countsFromPairs, pairSum);
    if (!mixed) return null;
    const plan = buildPlanArray(mixed);
    const patch: Partial<ActivitySpec> = { difficulty_plan: plan };
    if (args.currentProblemCount == null || args.currentProblemCount !== pairSum) {
      patch.problem_count = pairSum;
    }
    return { patch, explicitTotal: true };
  }

  // Otherwise, try single-difficulty shorthand like "easy", "all easy", "make it hard".
  const dominant = dominantDifficultyFromText(lower);
  if (!dominant) return null;

  // Try to find an explicit total count anywhere in the message (e.g. "make 4 problems easy").
  const num = lower.match(/\b(\d+)\b/);
  const explicitTotal = Boolean(num?.[1]);
  const inferredTotal = explicitTotal ? Number(num![1]) : args.currentProblemCount;
  if (!inferredTotal || !Number.isFinite(inferredTotal)) return null;
  const total = clampInt(inferredTotal, 1, 7);
  if (total < 2) return null;

  const base = makeEmptyCounts();
  base[dominant] = total;
  const mixed = coerceToMixedPlan(base, total);
  if (!mixed) return null;

  const plan = buildPlanArray(mixed);
  const patch: Partial<ActivitySpec> = { difficulty_plan: plan };
  if (explicitTotal && (args.currentProblemCount == null || args.currentProblemCount !== total)) {
    patch.problem_count = total;
  }

  return { patch, explicitTotal };
}

