import { activityDb, learnerProfileDb } from "../database";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseJsonObject(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return {};
}

function parseJsonArray(json: string | null | undefined): unknown[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

type FailureRow = { concept: string; count: number; last_seen: string };

function normalizeFailures(items: unknown[]): FailureRow[] {
  const out: FailureRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const concept = typeof (item as any).concept === "string" ? (item as any).concept.trim() : "";
    const count = Number((item as any).count);
    const last_seen = typeof (item as any).last_seen === "string" ? (item as any).last_seen : "";
    if (!concept) continue;
    if (!Number.isFinite(count) || count <= 0) continue;
    if (!last_seen) continue;
    out.push({ concept, count: Math.floor(count), last_seen });
  }
  return out.slice(0, 50);
}

/**
 * Phase 2A groundwork: deterministically update a per-user, per-language LearnerProfile
 * from an authenticated submission for a known activity problem.
 *
 * - No LLM
 * - No impact on validation/execution
 */
export function updateLearnerProfileFromSubmission(args: {
  userId: number;
  language: string;
  activityId: string;
  problemId: string;
  success: boolean;
}) {
  const activity = activityDb.findById(args.activityId);
  if (!activity) return;

  let problems: any[] = [];
  try {
    problems = JSON.parse(activity.problems);
  } catch {
    return;
  }
  if (!Array.isArray(problems)) return;

  const problem = problems.find((p) => p && typeof p === "object" && (p as any).id === args.problemId);
  if (!problem) return;

  const conceptRaw = (problem as any).topic_tag ?? (problem as any).topicTag ?? null;
  const concept = typeof conceptRaw === "string" ? conceptRaw.trim() : "";
  if (!concept) return;

  const existing = learnerProfileDb.findByUserAndLanguage(args.userId, args.language);
  const existingMastery = parseJsonObject(existing?.concept_mastery_json) as Record<string, unknown>;
  const existingFailures = normalizeFailures(parseJsonArray(existing?.recent_failures_json));

  const prev = typeof existingMastery[concept] === "number" ? (existingMastery[concept] as number) : 0.5;
  const target = args.success ? 1 : 0;
  const next = clamp01(prev * 0.9 + target * 0.1);

  const nextMastery: Record<string, number> = {};
  for (const [k, v] of Object.entries(existingMastery)) {
    if (typeof v === "number") nextMastery[k] = clamp01(v);
  }
  nextMastery[concept] = next;

  const nowIso = new Date().toISOString();
  const nextFailures = [...existingFailures];
  if (!args.success) {
    const idx = nextFailures.findIndex((f) => f.concept === concept);
    if (idx >= 0) {
      const cur = nextFailures[idx]!;
      nextFailures[idx] = { ...cur, count: Math.min(10_000, cur.count + 1), last_seen: nowIso };
    } else {
      nextFailures.unshift({ concept, count: 1, last_seen: nowIso });
    }
  }

  learnerProfileDb.upsert({
    userId: args.userId,
    language: args.language,
    conceptMasteryJson: JSON.stringify(nextMastery),
    recentFailuresJson: JSON.stringify(nextFailures.slice(0, 50)),
    preferredStyle: existing?.preferred_style ?? null,
  });
}

