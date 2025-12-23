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
const ambiguity_1 = require("./ambiguity");
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
function extractExplicitLanguage(userMessage) {
    const msg = userMessage.toLowerCase();
    if (/\bc\+\+\b/.test(msg) || /\bcpp\b/.test(msg))
        return "cpp";
    if (/\bpython\b/.test(msg))
        return "python";
    if (/\bjava\b/.test(msg))
        return "java";
    return null;
}
function isLanguageSwitchConfirmed(userMessage) {
    const msg = userMessage.trim().toLowerCase();
    if (msg === "python" || msg === "java" || msg === "cpp" || msg === "c++")
        return true;
    // Require both a confirmation-ish phrase and an explicit language mention.
    const hasConfirmWord = /\b(yes|yep|sure|ok|okay|confirm|proceed|switch|change|use|go with)\b/.test(msg);
    const hasLanguage = /\b(python|java|cpp)\b/.test(msg) || /\bc\+\+\b/.test(msg);
    return hasConfirmWord && hasLanguage;
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
    const locked = {};
    const store = args.commitments ?? {};
    for (const [k, v] of Object.entries(store)) {
        if (v?.locked === true)
            locked[k] = v.value;
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
    "language"?: "java" | "python" | "cpp",
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
function jsonStable(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function isExplicitForField(args) {
    const msg = args.userMessage.trim().toLowerCase();
    if (args.output?.revision?.replaces?.includes(args.field))
        return true;
    const qk = args.currentQuestionKey ?? null;
    if (qk === args.field)
        return true;
    if (qk?.startsWith("invalid:") && qk.slice("invalid:".length) === args.field)
        return true;
    if (qk?.startsWith("goal:")) {
        const goal = qk.slice("goal:".length);
        if (goal === "content" && args.field === "topic_tags")
            return true;
        if (goal === "scope" && args.field === "problem_count")
            return true;
        if (goal === "difficulty" && args.field === "difficulty_plan")
            return true;
        if (goal === "checking" && args.field === "problem_style")
            return true;
        if (goal === "language" && args.field === "language")
            return true;
    }
    if (args.field === "language")
        return /\b(java|python)\b/.test(msg);
    if (args.field === "problem_count") {
        return /(\b\d+\b)\s*(problems|problem|questions|question|exercises|exercise)\b/.test(msg) || /^(?:i want )?\d+\b/.test(msg);
    }
    if (args.field === "problem_style")
        return /\b(stdout|return|mixed)\b/.test(msg);
    if (args.field === "difficulty_plan")
        return /\b(easy|medium|hard)\b/.test(msg);
    if (args.field === "topic_tags")
        return msg.includes(",") || /\b(topic|topics|focus on|focus|cover|about)\b/.test(msg);
    return false;
}
function filterInferredPatchByCommitments(args) {
    const commitments = args.commitments ?? {};
    const next = { ...args.inferredPatch };
    for (const key of Object.keys(next)) {
        const committed = commitments[key];
        if (!committed?.locked)
            continue;
        const incoming = next[key];
        const same = jsonStable(incoming) === jsonStable(committed.value);
        if (same)
            continue;
        const explicit = isExplicitForField({
            field: key,
            userMessage: args.userMessage,
            currentQuestionKey: args.currentQuestionKey,
            output: args.output,
        });
        if (!explicit) {
            delete next[key];
        }
    }
    return next;
}
function isMixedDifficultyPlan(plan) {
    const nonZero = plan.filter((p) => typeof p?.count === "number" && Number.isFinite(p.count) && p.count > 0);
    const uniq = new Set(nonZero.map((p) => p.difficulty));
    return uniq.size >= 2;
}
function hasDuplicateDifficulty(plan) {
    const seen = new Set();
    for (const item of plan) {
        const d = String(item.difficulty);
        if (seen.has(d))
            return true;
        seen.add(d);
    }
    return false;
}
function sumPlanCounts(plan) {
    let sum = 0;
    for (const item of plan) {
        const n = item.count;
        if (typeof n === "number" && Number.isFinite(n))
            sum += n;
    }
    return sum;
}
function buildDifficultyClarification(problemCount) {
    if (typeof problemCount === "number" && Number.isFinite(problemCount) && problemCount >= 2) {
        const n = Math.floor(problemCount);
        const easy = Math.max(1, n - 1);
        return (`Codemm requires a mixed difficulty plan (at least 2 difficulty levels with count > 0), and counts must sum to ${n}.\n` +
            `Example: easy:${easy}, medium:1`);
    }
    return `Codemm requires a mixed difficulty plan (at least 2 difficulty levels with count > 0).`;
}
function defaultClarificationForBlockingField(field, currentSpec) {
    switch (field) {
        case "language": {
            const langs = (0, profiles_1.listAgentSelectableLanguages)().map((l) => l.toUpperCase()).join(", ");
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
async function resolveIntentWithLLM(args) {
    const userMessage = args.userMessage.trim();
    if (!userMessage) {
        return {
            kind: "noop",
            output: { inferredPatch: {}, confidence: {}, rationale: "Empty message." },
        };
    }
    // Deterministic language handling (do not rely on LLM JSON compliance):
    // - Default to Java when language is missing and user didn't specify.
    // - If user explicitly requests a language change, require confirmation.
    const explicitLanguage = extractExplicitLanguage(userMessage);
    const currentLanguage = args.currentSpec.language;
    const effectiveCurrentLanguage = currentLanguage ?? "java";
    const applyLanguagePatch = (language, rationale) => {
        const output = {
            inferredPatch: { language },
            confidence: { language: 1 },
            rationale,
            ...(currentLanguage && currentLanguage !== language
                ? { revision: { replaces: ["language"] } }
                : {}),
        };
        const patch = toTopLevelPatch(args.currentSpec, output.inferredPatch);
        const merged = (0, jsonPatch_1.applyJsonPatch)(args.currentSpec, patch);
        const fixedAfter = (0, specDraft_1.ensureFixedFields)(merged);
        const finalMerged = fixedAfter.length > 0 ? (0, jsonPatch_1.applyJsonPatch)(merged, fixedAfter) : merged;
        const contractError = (0, specDraft_1.validatePatchedSpecOrError)(finalMerged);
        if (contractError) {
            return { kind: "error", error: contractError };
        }
        const finalDraftCheck = specDraft_1.ActivitySpecDraftSchema.safeParse(finalMerged);
        if (!finalDraftCheck.success) {
            return { kind: "error", error: "Language patch failed draft validation." };
        }
        return { kind: "patch", patch: [...patch, ...fixedAfter], merged: finalMerged, output };
    };
    if (explicitLanguage) {
        const isSwitch = explicitLanguage !== effectiveCurrentLanguage;
        if (isSwitch && !isLanguageSwitchConfirmed(userMessage)) {
            return {
                kind: "clarify",
                question: `I can generate this in ${explicitLanguage.toUpperCase()}. Want to proceed with ${explicitLanguage.toUpperCase()}, or stick with ${effectiveCurrentLanguage.toUpperCase()}? Reply "${explicitLanguage}" to switch or "${effectiveCurrentLanguage}" to keep it.`,
                output: { inferredPatch: {}, confidence: {}, rationale: "Needs language switch confirmation." },
            };
        }
        // If the user explicitly said a supported language, accept immediately.
        if (currentLanguage === explicitLanguage) {
            return {
                kind: "noop",
                output: { inferredPatch: {}, confidence: { language: 1 }, rationale: `Language already set to ${explicitLanguage}.` },
            };
        }
        return applyLanguagePatch(explicitLanguage, `User explicitly selected ${explicitLanguage}.`);
    }
    if (!currentLanguage) {
        // Default language policy: if not explicitly mentioned, use Java.
        return applyLanguagePatch("java", "No language specified; defaulting to java.");
    }
    (0, trace_1.trace)("agent.intentResolver.start", { model: CODEX_MODEL });
    let rawText = "";
    try {
        const completion = await (0, codex_1.createCodexCompletion)({
            system: buildSystemPrompt(),
            user: buildUserPrompt({ userMessage, currentSpec: args.currentSpec, commitments: args.commitments }),
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
        let output = applyTopicDominanceHeuristic(args.currentSpec, userMessage, out.data);
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
        // Draft-safety precheck: if the LLM proposes an invalid difficulty_plan (not mixed / duplicates / wrong sum),
        // drop it deterministically and let the dialogue ask for a valid split next.
        if (Array.isArray(output.inferredPatch.difficulty_plan)) {
            const plan = output.inferredPatch.difficulty_plan;
            const countRaw = typeof output.inferredPatch.problem_count === "number"
                ? output.inferredPatch.problem_count
                : typeof args.currentSpec.problem_count === "number"
                    ? args.currentSpec.problem_count
                    : null;
            const count = typeof countRaw === "number" && Number.isFinite(countRaw) ? Math.floor(countRaw) : null;
            const sum = sumPlanCounts(plan);
            const mixed = isMixedDifficultyPlan(plan);
            const dup = hasDuplicateDifficulty(plan);
            const sumsOk = count == null ? true : sum === count;
            if (!mixed || dup || !sumsOk) {
                delete output.inferredPatch.difficulty_plan;
                delete output.confidence.difficulty_plan;
                if (!output.clarificationQuestion) {
                    output.clarificationQuestion = buildDifficultyClarification(count);
                }
            }
        }
        // Risk-aware ambiguity handling: drop BLOCKING fields; allow SAFE/DEFERABLE to apply.
        const risks = {};
        const blockingFields = [];
        for (const key of Object.keys(output.inferredPatch)) {
            const c = output.confidence?.[String(key)] ?? 0;
            const risk = (0, ambiguity_1.classifyAmbiguityRisk)(key, c);
            risks[String(key)] = risk;
            if (risk === ambiguity_1.AmbiguityRisk.BLOCKING) {
                blockingFields.push(key);
                delete output.inferredPatch[key];
            }
        }
        if (blockingFields.length > 0) {
            (0, trace_1.trace)("agent.intentResolver.ambiguity", { risks, blockingFields });
        }
        // Convert inferredPatch to JSON Patch ops and validate against draft contract.
        const patch = toTopLevelPatch(args.currentSpec, output.inferredPatch);
        if (patch.length === 0) {
            if (blockingFields.length > 0) {
                return {
                    kind: "clarify",
                    question: output.clarificationQuestion ?? defaultClarificationForBlockingField(blockingFields[0], args.currentSpec),
                    output,
                };
            }
            if (output.clarificationQuestion)
                return { kind: "clarify", question: output.clarificationQuestion, output };
            return { kind: "noop", output };
        }
        const inferredKeys = new Set(Object.keys(output.inferredPatch));
        const autoInvalidates = computeAutoInvalidations(args.currentSpec, output.inferredPatch);
        const userInvalidates = uniqueKeys(output.revision?.invalidates).filter((k) => !inferredKeys.has(k));
        const invalidates = uniqueKeys([...userInvalidates, ...autoInvalidates]);
        const invalidationPatch = invalidates.length > 0 ? buildInvalidationPatch(args.currentSpec, invalidates) : [];
        const merged = (0, jsonPatch_1.applyJsonPatch)(args.currentSpec, [...patch, ...invalidationPatch]);
        // Re-apply fixed invariants after patching (e.g. constraints must match language).
        const fixedAfter = (0, specDraft_1.ensureFixedFields)(merged);
        const finalMerged = fixedAfter.length > 0 ? (0, jsonPatch_1.applyJsonPatch)(merged, fixedAfter) : merged;
        const contractError = (0, specDraft_1.validatePatchedSpecOrError)(finalMerged);
        if (contractError) {
            (0, trace_1.trace)("agent.intentResolver.contract_reject", {
                error: contractError,
                patchOps: [...patch, ...invalidationPatch, ...fixedAfter].map((p) => p.path),
            });
            const clarification = output.clarificationQuestion ??
                `I might be misunderstanding. ${contractError} Can you rephrase what you want?`;
            return { kind: "clarify", question: clarification, output };
        }
        // Safety: ensure we only keep keys that the draft schema allows.
        const finalDraftCheck = specDraft_1.ActivitySpecDraftSchema.safeParse(finalMerged);
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
        return { kind: "patch", patch: [...patch, ...invalidationPatch, ...fixedAfter], merged: finalMerged, output: nextOutput };
    }
    catch (err) {
        (0, trace_1.trace)("agent.intentResolver.exception", { error: err?.message ?? String(err) });
        return { kind: "error", error: err?.message ?? "Intent resolver failed." };
    }
}
//# sourceMappingURL=intentResolver.js.map