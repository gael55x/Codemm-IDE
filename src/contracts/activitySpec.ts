import { z } from "zod";

export const CODEMM_SPEC_VERSION = "1.0" as const;
export const CODEMM_DEFAULT_TEST_CASE_COUNT = 8 as const;

// Backwards-compatible name; this is the Java default in Codemm v1.
export const CODEMM_DEFAULT_CONSTRAINTS = "Java 17, JUnit 5, no package declarations." as const;
export const CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE = {
  java: CODEMM_DEFAULT_CONSTRAINTS,
  python:
    "Python 3.11, pytest, standard library only, no filesystem access, no networking, time limit enforced." as const,
  cpp: "C++20, g++ (GNU), standard library only, no filesystem access, no networking, deterministic behavior." as const,
  sql: "SQLite 3 (SQL dialect), read-only queries only, deterministic results (explicit ORDER BY when needed)." as const,
} as const;

export const ActivityLanguageSchema = z.enum(["java", "python", "cpp", "sql"]);
export type ActivityLanguage = z.infer<typeof ActivityLanguageSchema>;

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const DifficultyPlanItemSchema = z
  .object({
    difficulty: DifficultySchema,
    count: z.number().int().min(0).max(7),
  })
  .strict();

export const DifficultyPlanSchema = z
  .array(DifficultyPlanItemSchema)
  .min(1)
  .max(3)
  .superRefine((items, ctx) => {
    const hasDuplicate = new Set(items.map((i) => i.difficulty)).size !== items.length;
    if (hasDuplicate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "difficulty_plan must not contain duplicate difficulty entries.",
      });
    }

    const nonZero = items.filter((i) => i.count > 0);
    if (nonZero.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "difficulty_plan must include at least one difficulty with count > 0.",
      });
    }
  });

export const ActivitySpecSchema = z
  .object({
    version: z.literal(CODEMM_SPEC_VERSION),

    language: ActivityLanguageSchema,

    // Max 7 (Codemm v1.0 rule)
    problem_count: z.number().int().min(1).max(7),

    // Difficulty plan; sum must equal problem_count
    difficulty_plan: DifficultyPlanSchema,

    topic_tags: z.array(z.string().trim().min(1).max(40)).min(1).max(12),

    // Intentionally a string for now; we can harden to enum later once UX is finalized.
    problem_style: z.string().trim().min(1).max(64),

    constraints: z.string().trim().min(1).max(2000),

    // Must be exactly 8 (Codemm v1.0 rule)
    test_case_count: z.literal(CODEMM_DEFAULT_TEST_CASE_COUNT),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const planSum = spec.difficulty_plan.reduce((sum, p) => sum + p.count, 0);
    if (planSum !== spec.problem_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["difficulty_plan"],
        message: `difficulty_plan counts must sum to problem_count (${spec.problem_count}). Got ${planSum}.`,
      });
    }

    const expectedConstraints = CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE[spec.language];
    if (spec.constraints !== expectedConstraints) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
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
          code: z.ZodIssueCode.custom,
          path: ["constraints"],
          message:
            "constraints must mention 'no package' and JUnit requirements (e.g. 'JUnit 5').",
        });
      }
    }
  });

export type ActivitySpec = z.infer<typeof ActivitySpecSchema>;

export function createEmptyActivitySpec(): ActivitySpec {
  return {
    version: CODEMM_SPEC_VERSION,
    language: "java",
    problem_count: 3,
    difficulty_plan: [
      { difficulty: "easy", count: 1 },
      { difficulty: "medium", count: 2 },
    ],
    topic_tags: ["oop"],
    problem_style: "stdout",
    constraints: CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE.java,
    test_case_count: CODEMM_DEFAULT_TEST_CASE_COUNT,
  };
}
