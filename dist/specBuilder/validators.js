"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivitySpecDraftSchema = void 0;
exports.ensureFixedFields = ensureFixedFields;
exports.isSpecComplete = isSpecComplete;
exports.validatePatchedSpecOrError = validatePatchedSpecOrError;
exports.buildPatchForLanguage = buildPatchForLanguage;
exports.buildPatchForProblemCount = buildPatchForProblemCount;
exports.parseDifficultyCounts = parseDifficultyCounts;
exports.buildPatchForDifficultyPlan = buildPatchForDifficultyPlan;
exports.buildPatchForTopicTags = buildPatchForTopicTags;
exports.buildPatchForProblemStyle = buildPatchForProblemStyle;
exports.buildPatchForConstraints = buildPatchForConstraints;
const zod_1 = require("zod");
const activitySpec_1 = require("../contracts/activitySpec");
/**
 * Draft validator: allows partial specs during DRAFT/CLARIFYING,
 * but enforces immediate local correctness for any fields that are present.
 */
exports.ActivitySpecDraftSchema = zod_1.z
    .object({
    version: zod_1.z.literal("1.0").optional(),
    language: activitySpec_1.ActivityLanguageSchema.optional(),
    problem_count: zod_1.z.number().int().min(1).max(7).optional(),
    difficulty_plan: activitySpec_1.DifficultyPlanSchema.optional(),
    topic_tags: zod_1.z.array(zod_1.z.string().trim().min(1).max(40)).min(1).max(12).optional(),
    problem_style: zod_1.z.string().trim().min(1).max(64).optional(),
    constraints: zod_1.z.string().trim().min(1).max(2000).optional(),
    test_case_count: zod_1.z.literal(8).optional(),
})
    .strict()
    .superRefine((spec, ctx) => {
    if (spec.problem_count != null && spec.difficulty_plan != null) {
        const planSum = spec.difficulty_plan.reduce((sum, p) => sum + p.count, 0);
        if (planSum !== spec.problem_count) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ["difficulty_plan"],
                message: `difficulty_plan counts must sum to problem_count (${spec.problem_count}). Got ${planSum}.`,
            });
        }
    }
    if (spec.constraints != null) {
        const c = spec.constraints.toLowerCase();
        const mentionsNoPackage = c.includes("no package");
        const mentionsJunit = c.includes("junit") || c.includes("junit 5");
        if (!mentionsNoPackage || !mentionsJunit) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ["constraints"],
                message: "constraints must mention 'no package' and JUnit requirements (e.g. 'JUnit 5').",
            });
        }
    }
});
function normalizeList(input) {
    const raw = input
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.toLowerCase());
    const unique = [];
    for (const tag of raw) {
        if (!unique.includes(tag))
            unique.push(tag);
    }
    return unique;
}
function parseIntStrict(s) {
    const trimmed = s.trim();
    if (!/^\d+$/.test(trimmed))
        return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
}
function ensureFixedFields(spec) {
    // Hard rule: test_case_count must be exactly 8.
    const patch = [];
    if (spec.test_case_count !== 8) {
        patch.push({ op: spec.test_case_count == null ? "add" : "replace", path: "/test_case_count", value: 8 });
    }
    if (spec.version !== "1.0") {
        patch.push({ op: spec.version == null ? "add" : "replace", path: "/version", value: "1.0" });
    }
    return patch;
}
function isSpecComplete(spec) {
    return activitySpec_1.ActivitySpecSchema.safeParse(spec).success;
}
function validatePatchedSpecOrError(patched) {
    const res = exports.ActivitySpecDraftSchema.safeParse(patched);
    if (res.success)
        return null;
    // Return first error message (kept short for chat UX).
    const first = res.error.issues[0];
    return first ? first.message : "Invalid ActivitySpec.";
}
function buildPatchForLanguage(answer) {
    const a = answer.trim().toLowerCase();
    if (a === "java") {
        return { patch: [{ op: "replace", path: "/language", value: "java" }] };
    }
    return { error: "Only 'java' is supported right now." };
}
function buildPatchForProblemCount(answer) {
    const n = parseIntStrict(answer);
    if (n == null)
        return { error: "Please enter a number from 1 to 7." };
    if (n < 1 || n > 7)
        return { error: "problem_count must be between 1 and 7." };
    return { patch: [{ op: "replace", path: "/problem_count", value: n }] };
}
function parseDifficultyCounts(answer) {
    const a = answer.toLowerCase();
    const pick = (key) => {
        const m = a.match(new RegExp(`${key}\\s*[:=]?\\s*(\\d+)`));
        return m && m[1] ? Number(m[1]) : undefined;
    };
    const byKey = {};
    const e = pick("easy");
    const m = pick("medium");
    const h = pick("hard");
    if (typeof e === "number")
        byKey.easy = e;
    if (typeof m === "number")
        byKey.medium = m;
    if (typeof h === "number")
        byKey.hard = h;
    const hasAnyKey = byKey.easy != null || byKey.medium != null || byKey.hard != null;
    if (hasAnyKey) {
        return byKey;
    }
    // Fallback: accept 3 integers like "2 3 1" or "2/3/1" as easy/medium/hard.
    const nums = a.match(/\d+/g)?.map((x) => Number(x)) ?? [];
    if (nums.length === 3) {
        const easy = nums[0];
        const medium = nums[1];
        const hard = nums[2];
        if (easy == null || medium == null || hard == null)
            return null;
        return { easy: easy, medium: medium, hard: hard };
    }
    return null;
}
function buildPatchForDifficultyPlan(spec, answer) {
    const problemCount = spec.problem_count;
    if (typeof problemCount !== "number") {
        return { error: "problem_count must be set before difficulty_plan." };
    }
    const counts = parseDifficultyCounts(answer);
    if (!counts) {
        return {
            error: "Provide counts for easy/medium/hard that sum to problem_count (e.g. 'easy:2, medium:2, hard:1').",
        };
    }
    const easy = Number.isFinite(counts.easy) ? (counts.easy ?? 0) : 0;
    const medium = Number.isFinite(counts.medium) ? (counts.medium ?? 0) : 0;
    const hard = Number.isFinite(counts.hard) ? (counts.hard ?? 0) : 0;
    if (![easy, medium, hard].every((n) => Number.isInteger(n) && n >= 0)) {
        return { error: "Difficulty counts must be non-negative integers." };
    }
    const sum = easy + medium + hard;
    if (sum !== problemCount) {
        return { error: `Counts must sum to ${problemCount}. Got ${sum}.` };
    }
    const nonZero = [easy, medium, hard].filter((n) => n > 0).length;
    if (nonZero < 2) {
        return { error: "difficulty_plan must be mixed (at least 2 non-zero difficulties)." };
    }
    // Build normalized array, omitting 0-count difficulties is allowed by schema.
    const plan = [
        { difficulty: "easy", count: easy },
        { difficulty: "medium", count: medium },
        { difficulty: "hard", count: hard },
    ]
        .filter((p) => p.count > 0)
        .map((p) => ({
        difficulty: activitySpec_1.DifficultySchema.parse(p.difficulty),
        count: p.count,
    }));
    return { patch: [{ op: "replace", path: "/difficulty_plan", value: plan }] };
}
function buildPatchForTopicTags(answer) {
    const tags = normalizeList(answer);
    if (tags.length < 1) {
        return { error: "Please provide at least 1 topic tag." };
    }
    if (tags.length > 12) {
        return { error: "Please provide at most 12 topic tags." };
    }
    return { patch: [{ op: "replace", path: "/topic_tags", value: tags }] };
}
function buildPatchForProblemStyle(answer) {
    const a = answer.trim().toLowerCase();
    const allowed = new Set(["stdout", "return", "mixed"]);
    if (!allowed.has(a)) {
        return { error: "problem_style must be one of: stdout, return, mixed." };
    }
    return { patch: [{ op: "replace", path: "/problem_style", value: a }] };
}
function buildPatchForConstraints(answer) {
    const text = answer.trim();
    if (!text)
        return { error: "constraints cannot be empty." };
    // Align with ActivitySpecSchema superRefine.
    const c = text.toLowerCase();
    const mentionsNoPackage = c.includes("no package");
    const mentionsJunit = c.includes("junit") || c.includes("junit 5");
    if (!mentionsNoPackage || !mentionsJunit) {
        return {
            error: "constraints must mention 'no package' and JUnit requirements (e.g. 'JUnit 5').",
        };
    }
    return { patch: [{ op: "replace", path: "/constraints", value: text }] };
}
//# sourceMappingURL=validators.js.map