import { z } from "zod";
import { ActivityLanguageSchema, CODEMM_DEFAULT_CONSTRAINTS } from "../contracts/activitySpec";
import type { ActivitySpec } from "../contracts/activitySpec";
import { createCodexCompletion } from "../infra/llm/codex";
import { tryParseJson } from "../utils/jsonParser";
import { trace, traceText } from "../utils/trace";
import { applyJsonPatch, type JsonPatchOp } from "../specBuilder/patch";
import { ActivitySpecDraftSchema, type SpecDraft, validatePatchedSpecOrError } from "../specBuilder/validators";

export type IntentResolutionResult =
  | { kind: "patch"; patch: JsonPatchOp[]; merged: SpecDraft; output: IntentResolutionOutput }
  | { kind: "clarify"; question: string; output: IntentResolutionOutput }
  | { kind: "noop"; output: IntentResolutionOutput }
  | { kind: "error"; error: string };

const CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-4.1";
const SUPPORTED_LANGUAGES = ActivityLanguageSchema.options.join(", ");

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
        problem_style: z.string().trim().min(1).max(64).optional(),
      })
      .strict(),
    confidence: z.record(z.string(), z.number().min(0).max(1)),
    rationale: z.string().trim().min(1).max(1200),
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

function buildSystemPrompt(): string {
  return `
You are Codemm's intent resolver.

Your job:
- Read the user's free-form message + the current partial ActivitySpec (JSON).
- Infer as many ActivitySpec fields as possible in ONE pass.
- Return a JSON object matching the provided schema.

Hard rules:
- Return ONLY valid JSON (no markdown, no code fences, no prose).
- Supported languages right now: ${SUPPORTED_LANGUAGES}. Never invent unsupported languages. If user asks for another language, ask a clarification question instead.
- Do not output constraints or test_case_count; those are system invariants.
- If your inference is uncertain, either set a low confidence score or ask a clarificationQuestion.
- Do not "force" a patch that contradicts the user's explicit statement.

Current system invariants (non-negotiable):
- constraints must be exactly "${CODEMM_DEFAULT_CONSTRAINTS}"
- test_case_count must be 8
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
    "language"?: "java",
    "problem_count"?: number,
    "difficulty_plan"?: [{"difficulty":"easy|medium|hard","count":number}, ...],
    "topic_tags"?: string[],
    "problem_style"?: string
  },
  "confidence": { "<fieldName>": number(0..1), ... },
  "rationale": "short explanation of what you inferred and why",
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

    const output = out.data;

    // Convert inferredPatch to JSON Patch ops and validate against draft contract.
    const patch = toTopLevelPatch(args.currentSpec, output.inferredPatch);
    if (patch.length === 0) {
      if (output.clarificationQuestion) {
        return { kind: "clarify", question: output.clarificationQuestion, output };
      }
      return { kind: "noop", output };
    }

    const merged = applyJsonPatch(args.currentSpec as any, patch) as SpecDraft;
    const contractError = validatePatchedSpecOrError(merged);
    if (contractError) {
      trace("agent.intentResolver.contract_reject", { error: contractError, patchOps: patch.map((p) => p.path) });
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

    return { kind: "patch", patch, merged, output };
  } catch (err: any) {
    trace("agent.intentResolver.exception", { error: err?.message ?? String(err) });
    return { kind: "error", error: err?.message ?? "Intent resolver failed." };
  }
}
