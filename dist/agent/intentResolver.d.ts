import { z } from "zod";
import { type JsonPatchOp } from "../specBuilder/patch";
import { type SpecDraft } from "../specBuilder/validators";
export type IntentResolutionResult = {
    kind: "patch";
    patch: JsonPatchOp[];
    merged: SpecDraft;
    output: IntentResolutionOutput;
} | {
    kind: "clarify";
    question: string;
    output: IntentResolutionOutput;
} | {
    kind: "noop";
    output: IntentResolutionOutput;
} | {
    kind: "error";
    error: string;
};
declare const IntentResolutionSchema: z.ZodEffects<z.ZodObject<{
    inferredPatch: z.ZodObject<{
        language: z.ZodOptional<z.ZodEnum<["java"]>>;
        problem_count: z.ZodOptional<z.ZodNumber>;
        difficulty_plan: z.ZodOptional<z.ZodArray<z.ZodObject<{
            difficulty: z.ZodEnum<["easy", "medium", "hard"]>;
            count: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }, {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }>, "many">>;
        topic_tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        problem_style: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        language?: "java" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: string | undefined;
    }, {
        language?: "java" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: string | undefined;
    }>;
    confidence: z.ZodRecord<z.ZodString, z.ZodNumber>;
    rationale: z.ZodString;
    clarificationQuestion: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    inferredPatch: {
        language?: "java" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: string | undefined;
    };
    confidence: Record<string, number>;
    rationale: string;
    clarificationQuestion?: string | undefined;
}, {
    inferredPatch: {
        language?: "java" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: string | undefined;
    };
    confidence: Record<string, number>;
    rationale: string;
    clarificationQuestion?: string | undefined;
}>, {
    inferredPatch: {
        language?: "java" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: string | undefined;
    };
    confidence: Record<string, number>;
    rationale: string;
    clarificationQuestion?: string | undefined;
}, {
    inferredPatch: {
        language?: "java" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: string | undefined;
    };
    confidence: Record<string, number>;
    rationale: string;
    clarificationQuestion?: string | undefined;
}>;
export type IntentResolutionOutput = z.infer<typeof IntentResolutionSchema>;
export declare function resolveIntentWithLLM(args: {
    userMessage: string;
    currentSpec: SpecDraft;
}): Promise<IntentResolutionResult>;
export {};
//# sourceMappingURL=intentResolver.d.ts.map