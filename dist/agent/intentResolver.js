"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveIntentWithLLM = resolveIntentWithLLM;
const zod_1 = require("zod");
const activitySpec_1 = require("../contracts/activitySpec");
const codex_1 = require("../infra/llm/codex");
const jsonParser_1 = require("../utils/jsonParser");
const trace_1 = require("../utils/trace");
const jsonPatch_1 = require("../compiler/jsonPatch");
const specDraft_1 = require("../compiler/specDraft");
const profiles_1 = require("../languages/profiles");
const dialogue_1 = require("./dialogue");
const CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-4.1";
const CONTRACT_LANGUAGES = activitySpec_1.ActivityLanguageSchema.options.join(", ");
const SELECTABLE_LANGUAGES = (0, profiles_1.listAgentSelectableLanguages)().join(", ");
const UserEditableKeySchema = zod_1.z.enum(dialogue_1.USER_EDITABLE_SPEC_KEYS);
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
        problem_style: zod_1.z.enum(["stdout", "return", "mixed"]).optional(),
    })
        .strict(),
    confidence: zod_1.z.record(zod_1.z.string(), zod_1.z.number().min(0).max(1)),
    rationale: zod_1.z.string().trim().min(1).max(1200),
    revision: zod_1.z
        .object({
        replaces: zod_1.z.array(UserEditableKeySchema).min(1).max(12).optional(),
        invalidates: zod_1.z.array(UserEditableKeySchema).min(1).max(12).optional(),
    })
        .strict()
        .optional(),
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
function uniqueKeys(keys) {
    if (!keys?.length)
        return [];
    return Array.from(new Set(keys));
}
function wantsTopicDominance(userMessage) {
    const msg = userMessage.toLowerCase();
    return (msg.includes("focus on") ||
        msg.includes("mostly") ||
        msg.includes("mainly") ||
        msg.includes("primarily") ||
        msg.includes("primarily on"));
}
function applyTopicDominanceHeuristic(currentSpec, userMessage, output) {
    if (!wantsTopicDominance(userMessage))
        return output;
    const incoming = output.inferredPatch.topic_tags;
    const existing = currentSpec.topic_tags;
    if (!Array.isArray(incoming) || incoming.length === 0)
        return output;
    if (!Array.isArray(existing) || existing.length === 0)
        return output;
    const norm = (s) => s.trim().toLowerCase();
    const existingSet = new Set(existing.map(norm));
    const delta = incoming.filter((t) => !existingSet.has(norm(t)));
    if (delta.length === 0)
        return output;
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
function computeAutoInvalidations(currentSpec, inferred) {
    const invalidates = [];
    // Upstream changes that logically invalidate dependent fields.
    if (typeof inferred.problem_count === "number") {
        if (currentSpec.difficulty_plan != null) {
            const existingSum = currentSpec.difficulty_plan.reduce((sum, item) => sum + item.count, 0);
            const countChanged = typeof currentSpec.problem_count === "number" ? currentSpec.problem_count !== inferred.problem_count : true;
            const willMismatch = existingSum !== inferred.problem_count;
            if (countChanged || willMismatch)
                invalidates.push("difficulty_plan");
        }
    }
    // If the user is explicitly supplying a new value for an invalidated key in this same turn,
    // do not throw it away.
    const inferredKeys = new Set(Object.keys(inferred));
    return uniqueKeys(invalidates).filter((k) => !inferredKeys.has(k));
}
function buildInvalidationPatch(spec, keys) {
    const patch = [];
    for (const key of keys) {
        if (spec[key] == null)
            continue;
        patch.push({ op: "remove", path: `/${key}` });
    }
    return patch;
}
function buildSystemPrompt() {
    const languageProfiles = Object.values(profiles_1.LANGUAGE_PROFILES)
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
- test_case_count must be ${activitySpec_1.CODEMM_DEFAULT_TEST_CASE_COUNT}

Language profiles:
${languageProfiles}
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
        const userInvalidates = uniqueKeys(output.revision?.invalidates).filter((k) => !inferredKeys.has(k));
        const invalidates = uniqueKeys([...userInvalidates, ...autoInvalidates]);
        const invalidationPatch = invalidates.length > 0 ? buildInvalidationPatch(args.currentSpec, invalidates) : [];
        const merged = (0, jsonPatch_1.applyJsonPatch)(args.currentSpec, [...patch, ...invalidationPatch]);
        const contractError = (0, specDraft_1.validatePatchedSpecOrError)(merged);
        if (contractError) {
            (0, trace_1.trace)("agent.intentResolver.contract_reject", {
                error: contractError,
                patchOps: [...patch, ...invalidationPatch].map((p) => p.path),
            });
            const clarification = output.clarificationQuestion ??
                `I might be misunderstanding. ${contractError} Can you rephrase what you want?`;
            return { kind: "clarify", question: clarification, output };
        }
        // Safety: ensure we only keep keys that the draft schema allows.
        const finalDraftCheck = specDraft_1.ActivitySpecDraftSchema.safeParse(merged);
        if (!finalDraftCheck.success) {
            (0, trace_1.trace)("agent.intentResolver.draft_schema_reject", { error: finalDraftCheck.error.issues[0]?.message ?? "draft invalid" });
            return { kind: "error", error: "Inferred patch failed draft validation." };
        }
        let nextOutput = output;
        if (invalidates.length > 0) {
            const nextRevision = {
                ...(output.revision?.replaces ? { replaces: output.revision.replaces } : {}),
                invalidates,
            };
            nextOutput = { ...output, revision: nextRevision };
        }
        return { kind: "patch", patch: [...patch, ...invalidationPatch], merged, output: nextOutput };
    }
    catch (err) {
        (0, trace_1.trace)("agent.intentResolver.exception", { error: err?.message ?? String(err) });
        return { kind: "error", error: err?.message ?? "Intent resolver failed." };
    }
}
//# sourceMappingURL=intentResolver.js.map