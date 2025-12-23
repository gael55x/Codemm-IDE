import { z } from "zod";
export declare const ProblemSlotSchema: z.ZodObject<{
    index: z.ZodNumber;
    difficulty: z.ZodEnum<["easy", "medium", "hard"]>;
    topics: z.ZodArray<z.ZodString, "many">;
    language: z.ZodEnum<["java", "python", "cpp"]>;
    problem_style: z.ZodString;
    constraints: z.ZodString;
    test_case_count: z.ZodLiteral<8>;
}, "strict", z.ZodTypeAny, {
    difficulty: "easy" | "medium" | "hard";
    language: "java" | "python" | "cpp";
    problem_style: string;
    constraints: string;
    test_case_count: 8;
    index: number;
    topics: string[];
}, {
    difficulty: "easy" | "medium" | "hard";
    language: "java" | "python" | "cpp";
    problem_style: string;
    constraints: string;
    test_case_count: 8;
    index: number;
    topics: string[];
}>;
export type ProblemSlot = z.infer<typeof ProblemSlotSchema>;
export declare const ProblemPlanSchema: z.ZodEffects<z.ZodArray<z.ZodObject<{
    index: z.ZodNumber;
    difficulty: z.ZodEnum<["easy", "medium", "hard"]>;
    topics: z.ZodArray<z.ZodString, "many">;
    language: z.ZodEnum<["java", "python", "cpp"]>;
    problem_style: z.ZodString;
    constraints: z.ZodString;
    test_case_count: z.ZodLiteral<8>;
}, "strict", z.ZodTypeAny, {
    difficulty: "easy" | "medium" | "hard";
    language: "java" | "python" | "cpp";
    problem_style: string;
    constraints: string;
    test_case_count: 8;
    index: number;
    topics: string[];
}, {
    difficulty: "easy" | "medium" | "hard";
    language: "java" | "python" | "cpp";
    problem_style: string;
    constraints: string;
    test_case_count: 8;
    index: number;
    topics: string[];
}>, "many">, {
    difficulty: "easy" | "medium" | "hard";
    language: "java" | "python" | "cpp";
    problem_style: string;
    constraints: string;
    test_case_count: 8;
    index: number;
    topics: string[];
}[], {
    difficulty: "easy" | "medium" | "hard";
    language: "java" | "python" | "cpp";
    problem_style: string;
    constraints: string;
    test_case_count: 8;
    index: number;
    topics: string[];
}[]>;
export type ProblemPlan = z.infer<typeof ProblemPlanSchema>;
//# sourceMappingURL=types.d.ts.map