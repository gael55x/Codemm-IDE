import { z } from "zod";
import { ActivityLanguageSchema, CODEMM_DEFAULT_TEST_CASE_COUNT } from "../contracts/activitySpec";
import { createCodexCompletion } from "../infra/llm/codex";
import { tryParseJson } from "../utils/jsonParser";
import { trace, traceText } from "../utils/trace";
import { applyJsonPatch, type JsonPatchOp } from "../compiler/jsonPatch";
import { ActivitySpecDraftSchema, ensureFixedFields, type SpecDraft, validatePatchedSpecOrError } from "../compiler/specDraft";
import { LANGUAGE_PROFILES, listAgentSelectableLanguages } from "../languages/profiles";
import { type DialogueRevision, USER_EDITABLE_SPEC_KEYS, type UserEditableSpecKey } from "./dialogue";
import type { CommitmentStore } from "./commitments";
import { AmbiguityRisk, classifyAmbiguityRisk } from "./ambiguity";

export type IntentResolutionResult =
  | { kind: "patch"; patch: JsonPatchOp[]; merged: SpecDraft; output: IntentResolutionOutput }
  | { kind: "clarify"; question: string; output: IntentResolutionOutput }
  | { kind: "noop"; output: IntentResolutionOutput }
  | { kind: "error"; error: string };

const CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-4.1";
const CONTRACT_LANGUAGES = ActivityLanguageSchema.options.join(", ");
const SELECTABLE_LANGUAGES = listAgentSelectableLanguages().join(", ");

const UserEditableKeySchema = z.enum(USER_EDITABLE_SPEC_KEYS as any);

const IntentResolutionSchema = z
  .object({
    inferredPatch: z
      .object({
        // NOTE: keep this aligned with ActivitySpec keys; add more keys as the contract grows.
        language: ActivityLanguageSchema.optional(),
        problem_count: z.number().int().min(1).max(7).optional(),
        difficulty_plan: z
          .array(
            z.object({
              difficulty: z.enum(["easy", "medium", "hard"]),
              count: z.number().int().min(0).max(7),
            })
          )
          .min(1)
          .max(3)
          .optional(),
        topic_tags: z.array(z.string().trim().min(1).max(40)).min(1).max(12).optional(),
        problem_style: z.enum(["stdout", "return", "mixed"]).optional(),
      })
      .strict(),
    confidence: z.record(z.string(), z.number().min(0).max(1)),
    rationale: z.string().trim().min(1).max(1200),
    revision: z
      .object({
        replaces: z.array(UserEditableKeySchema).min(1).max(12).optional(),
        invalidates: z.array(UserEditableKeySchema).min(1).max(12).optional(),
      })
      .strict()
      .optional(),
    clarificationQuestion: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const inferredKeys = Object.keys(val.inferredPatch);
    for (const key of inferredKeys) {
      if (!(key in val.confidence)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confidence", key],
          message: `confidence must include a score for inferred field "${key}".`,
        });
      }
    }
  });

export type IntentResolutionOutput = z.infer<typeof IntentResolutionSchema>;

function uniqueKeys(keys: UserEditableSpecKey[] | undefined): UserEditableSpecKey[] {
  if (!keys?.length) return [];
  return Array.from(new Set(keys));
}

function wantsTopicDominance(userMessage: string): boolean {
  const msg = userMessage.toLowerCase();
  return (
    msg.includes("focus on") ||
    msg.includes("mostly") ||
    msg.includes("mainly") ||
    msg.includes("primarily") ||
    msg.includes("primarily on")
  );
}

function extractExplicitLanguage(userMessage: string): "java" | "python" | "cpp" | "sql" | null {
  const msg = userMessage.toLowerCase();
  if (/\bsql\b/.test(msg) || /\bsqlite\b/.test(msg)) return "sql";
  if (/\bc\+\+\b/.test(msg) || /\bcpp\b/.test(msg)) return "cpp";
  if (/\bpython\b/.test(msg)) return "python";
  if (/\bjava\b/.test(msg)) return "java";
  return null;
}

function isLanguageSwitchConfirmed(userMessage: string): boolean {
  const msg = userMessage.trim().toLowerCase();
  if (msg === "python" || msg === "java" || msg === "cpp" || msg === "c++" || msg === "sql" || msg === "sqlite")
    return true;
  // Require both a confirmation-ish phrase and an explicit language mention.
  const hasConfirmWord =
    /\b(yes|yep|sure|ok|okay|confirm|proceed|switch|change|use|go with|want|wanna|prefer)\b/.test(msg);
  const hasLanguage = /\b(python|java|cpp|sql|sqlite)\b/.test(msg) || /\bc\+\+\b/.test(msg);
  return hasConfirmWord && hasLanguage;
}

function applyTopicDominanceHeuristic(
  currentSpec: SpecDraft,
  userMessage: string,
  output: IntentResolutionOutput
): IntentResolutionOutput {
  if (!wantsTopicDominance(userMessage)) return output;

  const incoming = output.inferredPatch.topic_tags;
  const existing = currentSpec.topic_tags;
  if (!Array.isArray(incoming) || incoming.length === 0) return output;
  if (!Array.isArray(existing) || existing.length === 0) return output;

  const norm = (s: string) => s.trim().toLowerCase();
  const existingSet = new Set(existing.map(norm));
  const delta = incoming.filter((t) => !existingSet.has(norm(t)));
  if (delta.length === 0) return output;

  const replaces = uniqueKeys([...(output.revision?.replaces ?? []), "topic_tags"]);
  return {
    ...output,
    inferredPatch: { ...output.inferredPatch, topic_tags: delta },
    revision: {
      ...(output.revision ?? {}),
      replaces,
    },
  };
}

function computeAutoInvalidations(currentSpec: SpecDraft, inferred: InferredPatch): UserEditableSpecKey[] {
  const invalidates: UserEditableSpecKey[] = [];

  // Upstream changes that logically invalidate dependent fields.
  if (typeof inferred.problem_count === "number") {
    if (currentSpec.difficulty_plan != null) {
      const existingSum = currentSpec.difficulty_plan.reduce((sum, item) => sum + item.count, 0);
      const countChanged =
        typeof currentSpec.problem_count === "number" ? currentSpec.problem_count !== inferred.problem_count : true;
      const willMismatch = existingSum !== inferred.problem_count;
      if (countChanged || willMismatch) invalidates.push("difficulty_plan");
    }
  }

  // If the user is explicitly supplying a new value for an invalidated key in this same turn,
  // do not throw it away.
  const inferredKeys = new Set(Object.keys(inferred));
  return uniqueKeys(invalidates).filter((k) => !inferredKeys.has(k));
}

function buildInvalidationPatch(spec: SpecDraft, keys: UserEditableSpecKey[]): JsonPatchOp[] {
  const patch: JsonPatchOp[] = [];
  for (const key of keys) {
    if ((spec as any)[key] == null) continue;
    patch.push({ op: "remove", path: `/${key}` });
  }
  return patch;
}

function buildSystemPrompt(): string {
  const languageProfiles = Object.values(LANGUAGE_PROFILES)
    .map((p) => {
      const avail = p.support.generation && p.support.judge ? "available" : "not available yet";
      return `- ${p.language}: runtime=${p.runtime}, tests=${p.testFramework}, constraints="${p.defaultConstraints}" (${avail})`;
    })
    .join("\n");

  return `
You are Codemm's intent resolver.

Your job:
- Read the user's free-form message + the current partial ActivitySpec (JSON).
- Infer as many ActivitySpec fields as possible in ONE pass.
- Return a JSON object matching the provided schema.

Hard rules:
- Return ONLY valid JSON (no markdown, no code fences, no prose).
- ActivitySpec contract languages: ${CONTRACT_LANGUAGES}.
- Product-supported (selectable) languages right now: ${SELECTABLE_LANGUAGES || "java"}.
- If the user asks for a language that is not selectable yet, ask a clarificationQuestion to switch to a selectable language (do NOT set language to an unavailable value).
- Do not output constraints or test_case_count; those are system invariants.
- If the user revises an earlier decision ("actually", "instead", "make it X", "change it to"), include a "revision" object:
  - replaces: which fields they are changing.
  - invalidates: which dependent fields should be cleared because they no longer make sense.
- revision.replaces and revision.invalidates may ONLY include: language, problem_count, difficulty_plan, topic_tags, problem_style.
- If the user expresses focus/dominance for topics ("focus on", "mostly", "mainly"), treat topic_tags as a REPLACEMENT (not an additive append) and include "revision.replaces": ["topic_tags"].
- If your inference is uncertain, either set a low confidence score or ask a clarificationQuestion.
- Do not "force" a patch that contradicts the user's explicit statement.

Current system invariants (non-negotiable):
- constraints are language-dependent and must match the active language profile exactly.
- test_case_count must be ${CODEMM_DEFAULT_TEST_CASE_COUNT}

Language profiles:
${languageProfiles}
`.trim();
}

function buildUserPrompt(args: {
  userMessage: string;
  currentSpec: SpecDraft;
  commitments?: CommitmentStore | undefined;
}): string {
  const locked: Record<string, unknown> = {};
  const store = args.commitments ?? {};
  for (const [k, v] of Object.entries(store)) {
    if ((v as any)?.locked === true) locked[k] = (v as any).value;
  }

  return `
User message:
${args.userMessage}

Current partial ActivitySpec (JSON):
${JSON.stringify(args.currentSpec)}

Locked commitments (do NOT change unless user explicitly contradicts):
${JSON.stringify(locked)}

Output JSON schema:
{
  "inferredPatch": {
    "language"?: "java" | "python" | "cpp" | "sql",
    "problem_count"?: number,
    "difficulty_plan"?: [{"difficulty":"easy|medium|hard","count":number}, ...],
    "topic_tags"?: string[],
    "problem_style"?: "stdout" | "return" | "mixed"
  },
  "confidence": { "<fieldName>": number(0..1), ... },
  "rationale": "short explanation of what you inferred and why",
  "revision"?: {
    "replaces"?: ["language"|"problem_count"|"difficulty_plan"|"topic_tags"|"problem_style", ...],
    "invalidates"?: ["language"|"problem_count"|"difficulty_plan"|"topic_tags"|"problem_style", ...]
  },
  "clarificationQuestion"?: "single follow-up question if needed"
}
`.trim();
}

type InferredPatch = IntentResolutionOutput["inferredPatch"];

function toTopLevelPatch(current: SpecDraft, inferred: InferredPatch): JsonPatchOp[] {
  const patch: JsonPatchOp[] = [];

  const keys = Object.keys(inferred) as (keyof InferredPatch)[];
  for (const key of keys) {
    const value = inferred[key];
    if (value === undefined) continue;
    patch.push({
      op: (current as any)[key] == null ? "add" : "replace",
      path: `/${String(key)}`,
      value,
    });
  }

  return patch;
}

function jsonStable(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isExplicitForField(args: {
  field: UserEditableSpecKey;
  userMessage: string;
  currentQuestionKey?: string | null | undefined;
  output?: IntentResolutionOutput | null | undefined;
}): boolean {
  const msg = args.userMessage.trim().toLowerCase();
  if (args.output?.revision?.replaces?.includes(args.field)) return true;
  const qk = args.currentQuestionKey ?? null;
  if (qk === args.field) return true;
  if (qk?.startsWith("invalid:") && qk.slice("invalid:".length) === args.field) return true;
  if (qk?.startsWith("goal:")) {
    const goal = qk.slice("goal:".length);
    if (goal === "content" && args.field === "topic_tags") return true;
    if (goal === "scope" && args.field === "problem_count") return true;
    if (goal === "difficulty" && args.field === "difficulty_plan") return true;
    if (goal === "checking" && args.field === "problem_style") return true;
    if (goal === "language" && args.field === "language") return true;
  }

  if (args.field === "language") return /\b(java|python|cpp|sql|sqlite)\b/.test(msg) || /\bc\+\+\b/.test(msg);
  if (args.field === "problem_count") {
    return /(\b\d+\b)\s*(problems|problem|questions|question|exercises|exercise)\b/.test(msg) || /^(?:i want )?\d+\b/.test(msg);
  }
  if (args.field === "problem_style") return /\b(stdout|return|mixed)\b/.test(msg);
  if (args.field === "difficulty_plan") return /\b(easy|medium|hard)\b/.test(msg);
  if (args.field === "topic_tags") return msg.includes(",") || /\b(topic|topics|focus on|focus|cover|about)\b/.test(msg);
  return false;
}

function filterInferredPatchByCommitments(args: {
  inferredPatch: InferredPatch;
  commitments?: CommitmentStore | undefined;
  userMessage: string;
  currentQuestionKey?: string | null | undefined;
  output?: IntentResolutionOutput | null;
}): InferredPatch {
  const commitments = args.commitments ?? {};
  const next: InferredPatch = { ...args.inferredPatch };

  for (const key of Object.keys(next) as UserEditableSpecKey[]) {
    const committed = (commitments as any)[key] as { locked?: boolean; value?: unknown } | undefined;
    if (!committed?.locked) continue;

    const incoming = (next as any)[key];
    const same = jsonStable(incoming) === jsonStable(committed.value);
    if (same) continue;

    const explicit = isExplicitForField({
      field: key,
      userMessage: args.userMessage,
      currentQuestionKey: args.currentQuestionKey,
      output: args.output,
    });
    if (!explicit) {
      delete (next as any)[key];
    }
  }

  return next;
}

function isMixedDifficultyPlan(plan: Array<{ difficulty: string; count: number }>): boolean {
  const nonZero = plan.filter((p) => typeof p?.count === "number" && Number.isFinite(p.count) && p.count > 0);
  const uniq = new Set(nonZero.map((p) => p.difficulty));
  return uniq.size >= 2;
}

function hasDuplicateDifficulty(plan: Array<{ difficulty: string; count: number }>): boolean {
  const seen = new Set<string>();
  for (const item of plan) {
    const d = String((item as any).difficulty);
    if (seen.has(d)) return true;
    seen.add(d);
  }
  return false;
}

function sumPlanCounts(plan: Array<{ difficulty: string; count: number }>): number {
  let sum = 0;
  for (const item of plan) {
    const n = (item as any).count;
    if (typeof n === "number" && Number.isFinite(n)) sum += n;
  }
  return sum;
}

function buildDifficultyClarification(problemCount: number | null): string {
  if (typeof problemCount === "number" && Number.isFinite(problemCount) && problemCount >= 2) {
    const n = Math.floor(problemCount);
    const easy = Math.max(1, n - 1);
    return (
      `Codemm requires a mixed difficulty plan (at least 2 difficulty levels with count > 0), and counts must sum to ${n}.\n` +
      `Example: easy:${easy}, medium:1`
    );
  }
  return `Codemm requires a mixed difficulty plan (at least 2 difficulty levels with count > 0).`;
}

function defaultClarificationForBlockingField(field: UserEditableSpecKey, currentSpec: SpecDraft): string {
  switch (field) {
    case "language": {
      const langs = listAgentSelectableLanguages().map((l) => l.toUpperCase()).join(", ");
      return `Which language should we use? (${langs || "JAVA"} is available today.)`;
    }
    case "problem_count":
      return "How many problems should we build? (1–7 works well.)";
    case "difficulty_plan": {
      const count = typeof currentSpec.problem_count === "number" ? currentSpec.problem_count : null;
      return count
        ? `How should we split the difficulty for ${count} problems?\nExample: easy:2, medium:2, hard:1`
        : "Should this be beginner-friendly, mixed, or interview-level?";
    }
    case "topic_tags":
      return "What should the problems focus on?\nExample: arrays, recursion, hash maps";
    case "problem_style":
      return "How should solutions be checked? (stdout, return, or mixed)";
    default:
      return "Can you clarify what you want?";
  }
}

export async function resolveIntentWithLLM(args: {
  userMessage: string;
  currentSpec: SpecDraft;
  commitments?: CommitmentStore | undefined;
  currentQuestionKey?: string | null | undefined;
}): Promise<IntentResolutionResult> {
  const userMessage = args.userMessage.trim();
  if (!userMessage) {
    return {
      kind: "noop",
      output: { inferredPatch: {}, confidence: {}, rationale: "Empty message." },
    };
  }

  // Language handling (deterministic) + multi-field inference:
  // - Allow language and other fields (topics, count, style) in the same user message.
  // - Default to Java only when missing (but don't block other inference).
  const explicitLanguage = extractExplicitLanguage(userMessage);
  const currentLanguage = args.currentSpec.language;
  const effectiveCurrentLanguage = currentLanguage ?? "java";
  const isBareLanguageMessage = /^(?:java|python|cpp|c\+\+|sql|sqlite)\s*$/i.test(userMessage);

  let baseSpec: SpecDraft = args.currentSpec;
  let basePatch: JsonPatchOp[] = [];
  let baseLanguageApplied: { language: "java" | "python" | "cpp" | "sql"; rationale: string; switched: boolean } | null =
    null;

  if (explicitLanguage) {
    const isSwitch = explicitLanguage !== effectiveCurrentLanguage;
    if (isSwitch && !isLanguageSwitchConfirmed(userMessage)) {
      return {
        kind: "clarify",
        question: `I can generate this in ${explicitLanguage.toUpperCase()}. Want to proceed with ${explicitLanguage.toUpperCase()}, or stick with ${effectiveCurrentLanguage.toUpperCase()}? Reply "${explicitLanguage}" to switch or "${effectiveCurrentLanguage}" to keep it.`,
        output: { inferredPatch: {}, confidence: {}, rationale: "Needs language switch confirmation." },
      };
    }

    if (currentLanguage !== explicitLanguage) {
      const inferred: InferredPatch = { language: explicitLanguage };
      const patch = toTopLevelPatch(baseSpec, inferred);
      const merged = applyJsonPatch(baseSpec as any, patch) as SpecDraft;
      const fixedAfter = ensureFixedFields(merged);
      const finalMerged =
        fixedAfter.length > 0 ? (applyJsonPatch(merged as any, fixedAfter) as SpecDraft) : merged;
      basePatch = [...basePatch, ...patch, ...fixedAfter];
      baseSpec = finalMerged;
      baseLanguageApplied = {
        language: explicitLanguage,
        rationale: `User explicitly selected ${explicitLanguage}.`,
        switched: Boolean(currentLanguage && currentLanguage !== explicitLanguage),
      };
    } else if (isBareLanguageMessage) {
      return {
        kind: "noop",
        output: {
          inferredPatch: {},
          confidence: { language: 1 },
          rationale: `Language already set to ${explicitLanguage}.`,
        },
      };
    }

    if (isBareLanguageMessage && basePatch.length > 0) {
      const out: IntentResolutionOutput = {
        inferredPatch: { language: baseLanguageApplied!.language },
        confidence: { language: 1 },
        rationale: baseLanguageApplied!.rationale,
        ...(baseLanguageApplied!.switched ? { revision: { replaces: ["language"] } } : {}),
      };
      return { kind: "patch", patch: basePatch, merged: baseSpec, output: out };
    }
  } else if (!currentLanguage) {
    const inferred: InferredPatch = { language: "java" };
    const patch = toTopLevelPatch(baseSpec, inferred);
    const merged = applyJsonPatch(baseSpec as any, patch) as SpecDraft;
    const fixedAfter = ensureFixedFields(merged);
    const finalMerged =
      fixedAfter.length > 0 ? (applyJsonPatch(merged as any, fixedAfter) as SpecDraft) : merged;
    basePatch = [...basePatch, ...patch, ...fixedAfter];
    baseSpec = finalMerged;
    baseLanguageApplied = { language: "java", rationale: "No language specified; defaulting to java.", switched: false };
  }

  trace("agent.intentResolver.start", { model: CODEX_MODEL });

  let rawText = "";
  try {
    const completion = await createCodexCompletion({
      system: buildSystemPrompt(),
      user: buildUserPrompt({ userMessage, currentSpec: baseSpec, commitments: args.commitments }),
      model: CODEX_MODEL,
      temperature: 0.2,
      maxTokens: 1200,
    });

    rawText = completion.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");

    traceText("agent.intentResolver.raw", rawText, { extra: { model: CODEX_MODEL } });

    const parsed = tryParseJson(rawText);
    const out = IntentResolutionSchema.safeParse(parsed);
    if (!out.success) {
      trace("agent.intentResolver.invalid_json", { error: out.error.issues[0]?.message ?? "schema validation failed" });
      return { kind: "error", error: "Intent resolver returned invalid JSON." };
    }

    let output = applyTopicDominanceHeuristic(baseSpec, userMessage, out.data);

    output = {
      ...output,
      inferredPatch: filterInferredPatchByCommitments({
        inferredPatch: output.inferredPatch,
        commitments: args.commitments,
        userMessage,
        currentQuestionKey: args.currentQuestionKey,
        output,
      }),
    };

    const baseLanguage = baseLanguageApplied?.language;

    // If language was handled deterministically above, do not allow the LLM to override it.
    if (typeof baseLanguage === "string") {
      delete (output.inferredPatch as any).language;
      delete (output.confidence as any).language;
      // Merge language signal back into the output for trace/commitment logic.
      const mergedReplaces = uniqueKeys([
        ...((output.revision?.replaces as any[]) ?? []),
        ...(baseLanguageApplied?.switched ? (["language"] as any[]) : []),
      ]);
      const mergedInvalidates = uniqueKeys([
        ...((output.revision?.invalidates as any[]) ?? []),
      ]);
      const mergedRevision =
        mergedReplaces.length > 0 || mergedInvalidates.length > 0
          ? ({
              ...(mergedReplaces.length > 0 ? { replaces: mergedReplaces } : {}),
              ...(mergedInvalidates.length > 0 ? { invalidates: mergedInvalidates } : {}),
            } as any)
          : undefined;

      output = {
        ...output,
        inferredPatch: { ...(output.inferredPatch as any), language: baseLanguage },
        confidence: { ...(output.confidence as any), language: 1 },
        rationale: `${baseLanguageApplied?.rationale ?? ""} ${output.rationale}`.trim().slice(0, 1200),
        ...(mergedRevision ? { revision: mergedRevision } : {}),
      };
    }

    // Draft-safety precheck: if the LLM proposes an invalid difficulty_plan (not mixed / duplicates / wrong sum),
    // drop it deterministically and let the dialogue ask for a valid split next.
    if (Array.isArray(output.inferredPatch.difficulty_plan)) {
      const plan = output.inferredPatch.difficulty_plan as any[];
      const countRaw =
        typeof output.inferredPatch.problem_count === "number"
          ? output.inferredPatch.problem_count
          : typeof args.currentSpec.problem_count === "number"
            ? args.currentSpec.problem_count
            : null;
      const count = typeof countRaw === "number" && Number.isFinite(countRaw) ? Math.floor(countRaw) : null;
      const sum = sumPlanCounts(plan as any);
      const mixed = isMixedDifficultyPlan(plan as any);
      const dup = hasDuplicateDifficulty(plan as any);
      const sumsOk = count == null ? true : sum === count;
      if (!mixed || dup || !sumsOk) {
        delete (output.inferredPatch as any).difficulty_plan;
        delete (output.confidence as any).difficulty_plan;
        if (!output.clarificationQuestion) {
          output.clarificationQuestion = buildDifficultyClarification(count);
        }
      }
    }

    // Risk-aware ambiguity handling: drop BLOCKING fields; allow SAFE/DEFERABLE to apply.
    const risks: Record<string, AmbiguityRisk> = {};
    const blockingFields: UserEditableSpecKey[] = [];
    for (const key of Object.keys(output.inferredPatch) as UserEditableSpecKey[]) {
      const c = output.confidence?.[String(key)] ?? 0;
      const risk = classifyAmbiguityRisk(key as any, c);
      risks[String(key)] = risk;
      if (risk === AmbiguityRisk.BLOCKING) {
        blockingFields.push(key);
        delete (output.inferredPatch as any)[key];
      }
    }
    if (blockingFields.length > 0) {
      trace("agent.intentResolver.ambiguity", { risks, blockingFields });
    }

    // Convert inferredPatch to JSON Patch ops and validate against draft contract.
    const effectiveInferred: InferredPatch = { ...(output.inferredPatch as any) };
    if (typeof baseLanguage === "string" && effectiveInferred.language === baseSpec.language) {
      delete (effectiveInferred as any).language;
    }

    const patch = toTopLevelPatch(baseSpec, effectiveInferred);
    const fullPatch = [...basePatch, ...patch];

    if (fullPatch.length === 0) {
      if (blockingFields.length > 0) {
        return {
          kind: "clarify",
          question: output.clarificationQuestion ?? defaultClarificationForBlockingField(blockingFields[0]!, baseSpec),
          output,
        };
      }
      if (output.clarificationQuestion) return { kind: "clarify", question: output.clarificationQuestion, output };
      return { kind: "noop", output };
    }

    const inferredKeys = new Set(Object.keys(effectiveInferred));
    const autoInvalidates = computeAutoInvalidations(baseSpec, effectiveInferred);
    const userInvalidates = uniqueKeys(output.revision?.invalidates as UserEditableSpecKey[] | undefined).filter(
      (k) => !inferredKeys.has(k)
    );
    const invalidates = uniqueKeys([...userInvalidates, ...autoInvalidates]);

    const invalidationPatch = invalidates.length > 0 ? buildInvalidationPatch(baseSpec, invalidates) : [];
    const merged = applyJsonPatch(baseSpec as any, [...patch, ...invalidationPatch]) as SpecDraft;

    // Re-apply fixed invariants after patching (e.g. constraints must match language).
    const fixedAfter = ensureFixedFields(merged);
    const finalMerged = fixedAfter.length > 0 ? (applyJsonPatch(merged as any, fixedAfter) as SpecDraft) : merged;

    const contractError = validatePatchedSpecOrError(finalMerged);
    if (contractError) {
      trace("agent.intentResolver.contract_reject", {
        error: contractError,
        patchOps: [...basePatch, ...patch, ...invalidationPatch, ...fixedAfter].map((p) => p.path),
      });
      const clarification =
        output.clarificationQuestion ??
        `I might be misunderstanding. ${contractError} Can you rephrase what you want?`;
      return { kind: "clarify", question: clarification, output };
    }

    // Safety: ensure we only keep keys that the draft schema allows.
    const finalDraftCheck = ActivitySpecDraftSchema.safeParse(finalMerged);
    if (!finalDraftCheck.success) {
      trace("agent.intentResolver.draft_schema_reject", { error: finalDraftCheck.error.issues[0]?.message ?? "draft invalid" });
      return { kind: "error", error: "Inferred patch failed draft validation." };
    }

    let nextOutput: IntentResolutionOutput = output;
    if (invalidates.length > 0) {
      const nextRevision: DialogueRevision = {
        ...(output.revision?.replaces ? { replaces: output.revision.replaces as any } : {}),
        invalidates,
      };
      nextOutput = { ...output, revision: nextRevision as any };
    }

    return {
      kind: "patch",
      patch: [...basePatch, ...patch, ...invalidationPatch, ...fixedAfter],
      merged: finalMerged,
      output: nextOutput,
    };
  } catch (err: any) {
    trace("agent.intentResolver.exception", { error: err?.message ?? String(err) });
    return { kind: "error", error: err?.message ?? "Intent resolver failed." };
  }
}
