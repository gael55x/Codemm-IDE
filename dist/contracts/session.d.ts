import { z } from "zod";
export declare const SessionStateSchema: z.ZodEnum<["DRAFT", "CLARIFYING", "READY", "GENERATING", "SAVED", "FAILED"]>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export declare const SessionMessageRoleSchema: z.ZodEnum<["user", "assistant"]>;
export type SessionMessageRole = z.infer<typeof SessionMessageRoleSchema>;
export declare const SessionMessageSchema: z.ZodObject<{
    id: z.ZodString;
    session_id: z.ZodString;
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodString;
    created_at: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    session_id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
}, {
    id: string;
    session_id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
}>;
export type SessionMessage = z.infer<typeof SessionMessageSchema>;
export declare const SessionSchema: z.ZodObject<{
    id: z.ZodString;
    state: z.ZodEnum<["DRAFT", "CLARIFYING", "READY", "GENERATING", "SAVED", "FAILED"]>;
    spec: z.ZodEffects<z.ZodObject<{
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
    created_at: z.ZodString;
    updated_at: z.ZodString;
    messages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        session_id: z.ZodString;
        role: z.ZodEnum<["user", "assistant"]>;
        content: z.ZodString;
        created_at: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
        session_id: string;
        role: "user" | "assistant";
        content: string;
        created_at: string;
    }, {
        id: string;
        session_id: string;
        role: "user" | "assistant";
        content: string;
        created_at: string;
    }>, "many">>;
    activity_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    last_error: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strict", z.ZodTypeAny, {
    id: string;
    created_at: string;
    state: "DRAFT" | "CLARIFYING" | "READY" | "GENERATING" | "SAVED" | "FAILED";
    spec: {
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
    };
    updated_at: string;
    messages?: {
        id: string;
        session_id: string;
        role: "user" | "assistant";
        content: string;
        created_at: string;
    }[] | undefined;
    activity_id?: string | null | undefined;
    last_error?: string | null | undefined;
}, {
    id: string;
    created_at: string;
    state: "DRAFT" | "CLARIFYING" | "READY" | "GENERATING" | "SAVED" | "FAILED";
    spec: {
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
    };
    updated_at: string;
    messages?: {
        id: string;
        session_id: string;
        role: "user" | "assistant";
        content: string;
        created_at: string;
    }[] | undefined;
    activity_id?: string | null | undefined;
    last_error?: string | null | undefined;
}>;
export type Session = z.infer<typeof SessionSchema>;
export declare function canTransition(from: SessionState, to: SessionState): boolean;
export declare function assertCanTransition(from: SessionState, to: SessionState): void;
//# sourceMappingURL=session.d.ts.map