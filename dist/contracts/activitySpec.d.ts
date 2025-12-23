import { z } from "zod";
export declare const CODEMM_SPEC_VERSION: "1.0";
export declare const CODEMM_DEFAULT_TEST_CASE_COUNT: 8;
export declare const CODEMM_DEFAULT_CONSTRAINTS: "Java 17, JUnit 5, no package declarations.";
export declare const CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE: {
    readonly java: "Java 17, JUnit 5, no package declarations.";
    readonly python: "Python 3.11, pytest, standard library only, no filesystem access, no networking, time limit enforced.";
    readonly cpp: "C++20, g++ (GNU), standard library only, no filesystem access, no networking, deterministic behavior.";
};
export declare const ActivityLanguageSchema: z.ZodEnum<["java", "python", "cpp"]>;
export type ActivityLanguage = z.infer<typeof ActivityLanguageSchema>;
export declare const DifficultySchema: z.ZodEnum<["easy", "medium", "hard"]>;
export type Difficulty = z.infer<typeof DifficultySchema>;
export declare const DifficultyPlanItemSchema: z.ZodObject<{
    difficulty: z.ZodEnum<["easy", "medium", "hard"]>;
    count: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    difficulty: "easy" | "medium" | "hard";
    count: number;
}, {
    difficulty: "easy" | "medium" | "hard";
    count: number;
}>;
export declare const DifficultyPlanSchema: z.ZodEffects<z.ZodArray<z.ZodObject<{
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
}[]>;
export declare const ActivitySpecSchema: z.ZodEffects<z.ZodObject<{
    version: z.ZodLiteral<"1.0">;
    language: z.ZodEnum<["java", "python", "cpp"]>;
    problem_count: z.ZodNumber;
    difficulty_plan: z.ZodEffects<z.ZodArray<z.ZodObject<{
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
    }[]>;
    topic_tags: z.ZodArray<z.ZodString, "many">;
    problem_style: z.ZodString;
    constraints: z.ZodString;
    test_case_count: z.ZodLiteral<8>;
}, "strict", z.ZodTypeAny, {
    version: "1.0";
    language: "java" | "python" | "cpp";
    problem_count: number;
    difficulty_plan: {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[];
    topic_tags: string[];
    problem_style: string;
    constraints: string;
    test_case_count: 8;
}, {
    version: "1.0";
    language: "java" | "python" | "cpp";
    problem_count: number;
    difficulty_plan: {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[];
    topic_tags: string[];
    problem_style: string;
    constraints: string;
    test_case_count: 8;
}>, {
    version: "1.0";
    language: "java" | "python" | "cpp";
    problem_count: number;
    difficulty_plan: {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[];
    topic_tags: string[];
    problem_style: string;
    constraints: string;
    test_case_count: 8;
}, {
    version: "1.0";
    language: "java" | "python" | "cpp";
    problem_count: number;
    difficulty_plan: {
        difficulty: "easy" | "medium" | "hard";
        count: number;
    }[];
    topic_tags: string[];
    problem_style: string;
    constraints: string;
    test_case_count: 8;
}>;
export type ActivitySpec = z.infer<typeof ActivitySpecSchema>;
export declare function createEmptyActivitySpec(): ActivitySpec;
//# sourceMappingURL=activitySpec.d.ts.map