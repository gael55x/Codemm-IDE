import Database from "better-sqlite3";
declare const db: Database.Database;
export declare function initializeDatabase(): void;
export interface User {
    id: number;
    username: string;
    email: string;
    password_hash: string;
    display_name?: string;
    created_at: string;
    updated_at: string;
}
export interface DBActivity {
    id: string;
    user_id: number;
    title: string;
    prompt?: string;
    problems: string;
    created_at: string;
}
export interface Submission {
    id: number;
    user_id: number;
    activity_id: string;
    problem_id: string;
    code: string;
    success: boolean;
    passed_tests: number;
    total_tests: number;
    execution_time_ms?: number;
    submitted_at: string;
}
export interface DBSession {
    id: string;
    user_id: number | null;
    state: string;
    spec_json: string;
    plan_json?: string | null;
    problems_json?: string | null;
    activity_id?: string | null;
    last_error?: string | null;
    confidence_json?: string | null;
    intent_trace_json?: string | null;
    created_at: string;
    updated_at: string;
}
export interface DBSessionMessage {
    id: string;
    session_id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
}
export interface DBSessionCollector {
    session_id: string;
    current_question_key: string | null;
    buffer_json: string;
    created_at: string;
    updated_at: string;
}
export declare const userDb: {
    create: (username: string, email: string, passwordHash: string, displayName?: string) => number;
    findByUsername: (username: string) => User | undefined;
    findByEmail: (email: string) => User | undefined;
    findById: (id: number) => User | undefined;
    updateDisplayName: (userId: number, displayName: string) => void;
};
export declare const activityDb: {
    create: (id: string, userId: number, title: string, problems: string, prompt?: string) => void;
    findById: (id: string) => DBActivity | undefined;
    findByUserId: (userId: number) => DBActivity[];
    delete: (id: string, userId: number) => void;
};
export declare const submissionDb: {
    create: (userId: number, activityId: string, problemId: string, code: string, success: boolean, passedTests: number, totalTests: number, executionTimeMs?: number) => number;
    findByActivityAndProblem: (userId: number, activityId: string, problemId: string) => Submission[];
    findByUser: (userId: number, limit?: number) => Submission[];
    getStatsByUser: (userId: number) => {
        total_submissions: number;
        successful_submissions: number;
        activities_attempted: number;
        problems_attempted: number;
        avg_execution_time: number;
    };
};
export declare const sessionDb: {
    create: (id: string, state: string, specJson: string, userId?: number | null) => void;
    findById: (id: string) => DBSession | undefined;
    updateState: (id: string, state: string) => void;
    updateSpecJson: (id: string, specJson: string) => void;
    setPlanJson: (id: string, planJson: string) => void;
    setProblemsJson: (id: string, problemsJson: string) => void;
    setActivityId: (id: string, activityId: string) => void;
    setLastError: (id: string, error: string | null) => void;
    updateConfidenceJson: (id: string, confidenceJson: string) => void;
    updateIntentTraceJson: (id: string, traceJson: string) => void;
};
export declare const sessionCollectorDb: {
    upsert: (sessionId: string, currentQuestionKey: string | null, buffer: string[]) => void;
    findBySessionId: (sessionId: string) => DBSessionCollector | undefined;
};
export declare const sessionMessageDb: {
    create: (id: string, sessionId: string, role: "user" | "assistant", content: string) => void;
    findBySessionId: (sessionId: string) => DBSessionMessage[];
};
export default db;
//# sourceMappingURL=database.d.ts.map