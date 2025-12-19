import { z } from "zod";
import { ActivityLanguageSchema, CODEMM_DEFAULT_TEST_CASE_COUNT } from "../contracts/activitySpec";
import type { ActivitySpec } from "../contracts/activitySpec";
import { createCodexCompletion } from "../infra/llm/codex";
import { tryParseJson } from "../utils/jsonParser";
import { trace, traceText } from "../utils/trace";
import { applyJsonPatch, type JsonPatchOp } from "../compiler/jsonPatch";
import { ActivitySpecDraftSchema, type SpecDraft, validatePatchedSpecOrError } from "../compiler/specDraft";
import { LANGUAGE_PROFILES, listAgentSelectableLanguages } from "../languages/profiles";
import { type DialogueRevision, USER_EDITABLE_SPEC_KEYS, type UserEditableSpecKey } from "./dialogue";

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
}): string {
  return `
User message:
${args.userMessage}

Current partial ActivitySpec (JSON):
${JSON.stringify(args.currentSpec)}

Output JSON schema:
{
  "inferredPatch": {
    "language"?: "java" | "python",
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

export async function resolveIntentWithLLM(args: {
  userMessage: string;
  currentSpec: SpecDraft;
}): Promise<IntentResolutionResult> {
  const userMessage = args.userMessage.trim();
  if (!userMessage) {
    return {
      kind: "noop",
      output: { inferredPatch: {}, confidence: {}, rationale: "Empty message." },
    };
  }

  trace("agent.intentResolver.start", { model: CODEX_MODEL });

  let rawText = "";
  try {
    const completion = await createCodexCompletion({
      system: buildSystemPrompt(),
      user: buildUserPrompt({ userMessage, currentSpec: args.currentSpec }),
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

    const output = applyTopicDominanceHeuristic(args.currentSpec, userMessage, out.data);

    // Convert inferredPatch to JSON Patch ops and validate against draft contract.
    const patch = toTopLevelPatch(args.currentSpec, output.inferredPatch);
    if (patch.length === 0) {
      if (output.clarificationQuestion) {
        return { kind: "clarify", question: output.clarificationQuestion, output };
      }
      return { kind: "noop", output };
    }

    const inferredKeys = new Set(Object.keys(output.inferredPatch));
    const autoInvalidates = computeAutoInvalidations(args.currentSpec, output.inferredPatch);
    const userInvalidates = uniqueKeys(output.revision?.invalidates as UserEditableSpecKey[] | undefined).filter(
      (k) => !inferredKeys.has(k)
    );
    const invalidates = uniqueKeys([...userInvalidates, ...autoInvalidates]);

    const invalidationPatch = invalidates.length > 0 ? buildInvalidationPatch(args.currentSpec, invalidates) : [];
    const merged = applyJsonPatch(args.currentSpec as any, [...patch, ...invalidationPatch]) as SpecDraft;
    const contractError = validatePatchedSpecOrError(merged);
    if (contractError) {
      trace("agent.intentResolver.contract_reject", {
        error: contractError,
        patchOps: [...patch, ...invalidationPatch].map((p) => p.path),
      });
      const clarification =
        output.clarificationQuestion ??
        `I might be misunderstanding. ${contractError} Can you rephrase what you want?`;
      return { kind: "clarify", question: clarification, output };
    }

    // Safety: ensure we only keep keys that the draft schema allows.
    const finalDraftCheck = ActivitySpecDraftSchema.safeParse(merged);
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

    return { kind: "patch", patch: [...patch, ...invalidationPatch], merged, output: nextOutput };
  } catch (err: any) {
    trace("agent.intentResolver.exception", { error: err?.message ?? String(err) });
    return { kind: "error", error: err?.message ?? "Intent resolver failed." };
  }
}
