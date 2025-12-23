import { z } from "zod";
import { type JsonPatchOp } from "../compiler/jsonPatch";
import { type SpecDraft } from "../compiler/specDraft";
import type { CommitmentStore } from "./commitments";
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
        language: z.ZodOptional<z.ZodEnum<["java", "python", "cpp"]>>;
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
        problem_style: z.ZodOptional<z.ZodEnum<["stdout", "return", "mixed"]>>;
    }, "strict", z.ZodTypeAny, {
        language?: "java" | "python" | "cpp" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: "stdout" | "return" | "mixed" | undefined;
    }, {
        language?: "java" | "python" | "cpp" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: "stdout" | "return" | "mixed" | undefined;
    }>;
    confidence: z.ZodRecord<z.ZodString, z.ZodNumber>;
    rationale: z.ZodString;
    revision: z.ZodOptional<z.ZodObject<{
        replaces: z.ZodOptional<z.ZodArray<z.ZodEnum<z.Writeable<any>>, "many">>;
        invalidates: z.ZodOptional<z.ZodArray<z.ZodEnum<z.Writeable<any>>, "many">>;
    }, "strict", z.ZodTypeAny, {
        replaces?: any[] | undefined;
        invalidates?: any[] | undefined;
    }, {
        replaces?: any[] | undefined;
        invalidates?: any[] | undefined;
    }>>;
    clarificationQuestion: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    confidence: Record<string, number>;
    inferredPatch: {
        language?: "java" | "python" | "cpp" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: "stdout" | "return" | "mixed" | undefined;
    };
    rationale: string;
    revision?: {
        replaces?: any[] | undefined;
        invalidates?: any[] | undefined;
    } | undefined;
    clarificationQuestion?: string | undefined;
}, {
    confidence: Record<string, number>;
    inferredPatch: {
        language?: "java" | "python" | "cpp" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: "stdout" | "return" | "mixed" | undefined;
    };
    rationale: string;
    revision?: {
        replaces?: any[] | undefined;
        invalidates?: any[] | undefined;
    } | undefined;
    clarificationQuestion?: string | undefined;
}>, {
    confidence: Record<string, number>;
    inferredPatch: {
        language?: "java" | "python" | "cpp" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: "stdout" | "return" | "mixed" | undefined;
    };
    rationale: string;
    revision?: {
        replaces?: any[] | undefined;
        invalidates?: any[] | undefined;
    } | undefined;
    clarificationQuestion?: string | undefined;
}, {
    confidence: Record<string, number>;
    inferredPatch: {
        language?: "java" | "python" | "cpp" | undefined;
        problem_count?: number | undefined;
        difficulty_plan?: {
            difficulty: "easy" | "medium" | "hard";
            count: number;
        }[] | undefined;
        topic_tags?: string[] | undefined;
        problem_style?: "stdout" | "return" | "mixed" | undefined;
    };
    rationale: string;
    revision?: {
        replaces?: any[] | undefined;
        invalidates?: any[] | undefined;
    } | undefined;
    clarificationQuestion?: string | undefined;
}>;
export type IntentResolutionOutput = z.infer<typeof IntentResolutionSchema>;
export declare function resolveIntentWithLLM(args: {
    userMessage: string;
    currentSpec: SpecDraft;
    commitments?: CommitmentStore | undefined;
    currentQuestionKey?: string | null | undefined;
}): Promise<IntentResolutionResult>;
export {};
//# sourceMappingURL=intentResolver.d.ts.map