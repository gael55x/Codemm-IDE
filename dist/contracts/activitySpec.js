"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivitySpecSchema = exports.DifficultyPlanSchema = exports.DifficultyPlanItemSchema = exports.DifficultySchema = exports.ActivityLanguageSchema = exports.CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE = exports.CODEMM_DEFAULT_CONSTRAINTS = exports.CODEMM_DEFAULT_TEST_CASE_COUNT = exports.CODEMM_SPEC_VERSION = void 0;
exports.createEmptyActivitySpec = createEmptyActivitySpec;
const zod_1 = require("zod");
exports.CODEMM_SPEC_VERSION = "1.0";
exports.CODEMM_DEFAULT_TEST_CASE_COUNT = 8;
// Backwards-compatible name; this is the Java default in Codemm v1.
exports.CODEMM_DEFAULT_CONSTRAINTS = "Java 17, JUnit 5, no package declarations.";
exports.CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE = {
    java: exports.CODEMM_DEFAULT_CONSTRAINTS,
    python: "Python 3.11, pytest, standard library only, no filesystem access, no networking, time limit enforced.",
    cpp: "C++20, g++ (GNU), standard library only, no filesystem access, no networking, deterministic behavior.",
};
exports.ActivityLanguageSchema = zod_1.z.enum(["java", "python", "cpp"]);
exports.DifficultySchema = zod_1.z.enum(["easy", "medium", "hard"]);
exports.DifficultyPlanItemSchema = zod_1.z
    .object({
    difficulty: exports.DifficultySchema,
    count: zod_1.z.number().int().min(0).max(7),
})
    .strict();
exports.DifficultyPlanSchema = zod_1.z
    .array(exports.DifficultyPlanItemSchema)
    .min(1)
    .max(3)
    .superRefine((items, ctx) => {
    const hasDuplicate = new Set(items.map((i) => i.difficulty)).size !== items.length;
    if (hasDuplicate) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "difficulty_plan must not contain duplicate difficulty entries.",
        });
    }
    const nonZero = items.filter((i) => i.count > 0);
    if (nonZero.length < 2) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "difficulty_plan must be mixed (at least 2 difficulties with count > 0).",
        });
    }
});
exports.ActivitySpecSchema = zod_1.z
    .object({
    version: zod_1.z.literal(exports.CODEMM_SPEC_VERSION),
    language: exports.ActivityLanguageSchema,
    // Max 7 (Codemm v1.0 rule)
    problem_count: zod_1.z.number().int().min(1).max(7),
    // Mixed difficulty; sum must equal problem_count
    difficulty_plan: exports.DifficultyPlanSchema,
    topic_tags: zod_1.z.array(zod_1.z.string().trim().min(1).max(40)).min(1).max(12),
    // Intentionally a string for now; we can harden to enum later once UX is finalized.
    problem_style: zod_1.z.string().trim().min(1).max(64),
    constraints: zod_1.z.string().trim().min(1).max(2000),
    // Must be exactly 8 (Codemm v1.0 rule)
    test_case_count: zod_1.z.literal(exports.CODEMM_DEFAULT_TEST_CASE_COUNT),
})
    .strict()
    .superRefine((spec, ctx) => {
    const planSum = spec.difficulty_plan.reduce((sum, p) => sum + p.count, 0);
    if (planSum !== spec.problem_count) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["difficulty_plan"],
            message: `difficulty_plan counts must sum to problem_count (${spec.problem_count}). Got ${planSum}.`,
        });
    }
    const expectedConstraints = exports.CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE[spec.language];
    if (spec.constraints !== expectedConstraints) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["constraints"],
            message: `constraints must be exactly "${expectedConstraints}" for language "${spec.language}".`,
        });
    }
    // Java-only invariants enforced via constraints.
    if (spec.language === "java") {
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
function createEmptyActivitySpec() {
    return {
        version: exports.CODEMM_SPEC_VERSION,
        language: "java",
        problem_count: 3,
        difficulty_plan: [
            { difficulty: "easy", count: 1 },
            { difficulty: "medium", count: 2 },
        ],
        topic_tags: ["oop"],
        problem_style: "stdout",
        constraints: exports.CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE.java,
        test_case_count: exports.CODEMM_DEFAULT_TEST_CASE_COUNT,
    };
}
//# sourceMappingURL=activitySpec.js.map