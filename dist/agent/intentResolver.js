"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveIntentWithLLM = resolveIntentWithLLM;
const zod_1 = require("zod");
const activitySpec_1 = require("../contracts/activitySpec");
const codex_1 = require("../infra/llm/codex");
const jsonParser_1 = require("../utils/jsonParser");
const trace_1 = require("../utils/trace");
const patch_1 = require("../specBuilder/patch");
const validators_1 = require("../specBuilder/validators");
const CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-4.1";
const SUPPORTED_LANGUAGES = activitySpec_1.ActivityLanguageSchema.options.join(", ");
const IntentResolutionSchema = zod_1.z
    .object({
    inferredPatch: zod_1.z
        .object({
        // NOTE: keep this aligned with ActivitySpec keys; add more keys as the contract grows.
        language: activitySpec_1.ActivityLanguageSchema.optional(),
        problem_count: zod_1.z.number().int().min(1).max(7).optional(),
        difficulty_plan: zod_1.z
            .array(zod_1.z.object({
            difficulty: zod_1.z.enum(["easy", "medium", "hard"]),
            count: zod_1.z.number().int().min(0).max(7),
        }))
            .min(1)
            .max(3)
            .optional(),
        topic_tags: zod_1.z.array(zod_1.z.string().trim().min(1).max(40)).min(1).max(12).optional(),
        problem_style: zod_1.z.string().trim().min(1).max(64).optional(),
    })
        .strict(),
    confidence: zod_1.z.record(zod_1.z.string(), zod_1.z.number().min(0).max(1)),
    rationale: zod_1.z.string().trim().min(1).max(1200),
    clarificationQuestion: zod_1.z.string().trim().min(1).max(500).optional(),
})
    .strict()
    .superRefine((val, ctx) => {
    const inferredKeys = Object.keys(val.inferredPatch);
    for (const key of inferredKeys) {
        if (!(key in val.confidence)) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ["confidence", key],
                message: `confidence must include a score for inferred field "${key}".`,
            });
        }
    }
});
function buildSystemPrompt() {
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
- constraints must be exactly "${activitySpec_1.CODEMM_DEFAULT_CONSTRAINTS}"
- test_case_count must be 8
`.trim();
}
function buildUserPrompt(args) {
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
function toTopLevelPatch(current, inferred) {
    const patch = [];
    const keys = Object.keys(inferred);
    for (const key of keys) {
        const value = inferred[key];
        if (value === undefined)
            continue;
        patch.push({
            op: current[key] == null ? "add" : "replace",
            path: `/${String(key)}`,
            value,
        });
    }
    return patch;
}
async function resolveIntentWithLLM(args) {
    const userMessage = args.userMessage.trim();
    if (!userMessage) {
        return {
            kind: "noop",
            output: { inferredPatch: {}, confidence: {}, rationale: "Empty message." },
        };
    }
    (0, trace_1.trace)("agent.intentResolver.start", { model: CODEX_MODEL });
    let rawText = "";
    try {
        const completion = await (0, codex_1.createCodexCompletion)({
            system: buildSystemPrompt(),
            user: buildUserPrompt({ userMessage, currentSpec: args.currentSpec }),
            model: CODEX_MODEL,
            temperature: 0.2,
            maxTokens: 1200,
        });
        rawText = completion.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("\n");
        (0, trace_1.traceText)("agent.intentResolver.raw", rawText, { extra: { model: CODEX_MODEL } });
        const parsed = (0, jsonParser_1.tryParseJson)(rawText);
        const out = IntentResolutionSchema.safeParse(parsed);
        if (!out.success) {
            (0, trace_1.trace)("agent.intentResolver.invalid_json", { error: out.error.issues[0]?.message ?? "schema validation failed" });
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
        const merged = (0, patch_1.applyJsonPatch)(args.currentSpec, patch);
        const contractError = (0, validators_1.validatePatchedSpecOrError)(merged);
        if (contractError) {
            (0, trace_1.trace)("agent.intentResolver.contract_reject", { error: contractError, patchOps: patch.map((p) => p.path) });
            const clarification = output.clarificationQuestion ??
                `I might be misunderstanding. ${contractError} Can you rephrase what you want?`;
            return { kind: "clarify", question: clarification, output };
        }
        // Safety: ensure we only keep keys that the draft schema allows.
        const finalDraftCheck = validators_1.ActivitySpecDraftSchema.safeParse(merged);
        if (!finalDraftCheck.success) {
            (0, trace_1.trace)("agent.intentResolver.draft_schema_reject", { error: finalDraftCheck.error.issues[0]?.message ?? "draft invalid" });
            return { kind: "error", error: "Inferred patch failed draft validation." };
        }
        return { kind: "patch", patch, merged, output };
    }
    catch (err) {
        (0, trace_1.trace)("agent.intentResolver.exception", { error: err?.message ?? String(err) });
        return { kind: "error", error: err?.message ?? "Intent resolver failed." };
    }
}
//# sourceMappingURL=intentResolver.js.map