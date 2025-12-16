import { z } from "zod";
import type { ActivitySpec } from "../contracts/activitySpec";
import type { JsonPatchOp } from "./patch";
export type SpecDraft = Partial<ActivitySpec> & {
    version?: "1.0";
};
/**
 * Draft validator: allows partial specs during DRAFT/CLARIFYING,
 * but enforces immediate local correctness for any fields that are present.
 */
export declare const ActivitySpecDraftSchema: z.ZodEffects<z.ZodObject<{
    version: z.ZodOptional<z.ZodLiteral<"1.0">>;
    language: z.ZodOptional<z.ZodEnum<["java"]>>;
    problem_count: z.ZodOptional<z.ZodNumber>;
    difficulty_plan: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodObject<{
        difficulty: z.ZodEnum<["easy", "medium", "hard"]>;
        count: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }, {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }>, "many">, {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[], {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[]>>;
    topic_tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    problem_style: z.ZodOptional<z.ZodString>;
    constraints: z.ZodOptional<z.ZodString>;
    test_case_count: z.ZodOptional<z.ZodLiteral<8>>;
}, "strict", z.ZodTypeAny, {
    version?: "1.0" | undefined;
    language?: "java" | undefined;
    problem_count?: number | undefined;
    difficulty_plan?: {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[] | undefined;
    topic_tags?: string[] | undefined;
    problem_style?: string | undefined;
    constraints?: string | undefined;
    test_case_count?: 8 | undefined;
}, {
    version?: "1.0" | undefined;
    language?: "java" | undefined;
    problem_count?: number | undefined;
    difficulty_plan?: {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[] | undefined;
    topic_tags?: string[] | undefined;
    problem_style?: string | undefined;
    constraints?: string | undefined;
    test_case_count?: 8 | undefined;
}>, {
    version?: "1.0" | undefined;
    language?: "java" | undefined;
    problem_count?: number | undefined;
    difficulty_plan?: {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[] | undefined;
    topic_tags?: string[] | undefined;
    problem_style?: string | undefined;
    constraints?: string | undefined;
    test_case_count?: 8 | undefined;
}, {
    version?: "1.0" | undefined;
    language?: "java" | undefined;
    problem_count?: number | undefined;
    difficulty_plan?: {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[] | undefined;
    topic_tags?: string[] | undefined;
    problem_style?: string | undefined;
    constraints?: string | undefined;
    test_case_count?: 8 | undefined;
}>;
export declare function ensureFixedFields(spec: SpecDraft): JsonPatchOp[];
export declare function isSpecComplete(spec: SpecDraft): spec is ActivitySpec;
export declare function validatePatchedSpecOrError(patched: SpecDraft): string | null;
export declare function buildPatchForLanguage(answer: string): {
    patch?: JsonPatchOp[];
    error?: string;
};
export declare function buildPatchForProblemCount(answer: string): {
    patch?: JsonPatchOp[];
    error?: string;
};
export declare function parseDifficultyCounts(answer: string): {
    easy?: number;
    medium?: number;
    hard?: number;
} | null;
export declare function buildPatchForDifficultyPlan(spec: SpecDraft, answer: string): {
    patch?: JsonPatchOp[];
    error?: string;
};
export declare function buildPatchForTopicTags(answer: string): {
    patch?: JsonPatchOp[];
    error?: string;
};
export declare function buildPatchForProblemStyle(answer: string): {
    patch?: JsonPatchOp[];
    error?: string;
};
export declare function buildPatchForConstraints(answer: string): {
    patch?: JsonPatchOp[];
    error?: string;
};
//# sourceMappingURL=validators.d.ts.map