import { type SessionState } from "../contracts/session";
import { type JsonPatchOp } from "../specBuilder/patch";
import type { GeneratedProblem } from "../contracts/problem";
import { type SpecQuestionKey } from "../specBuilder/questions";
export type SessionRecord = {
    id: string;
    state: SessionState;
    spec: Record<string, unknown>;
    messages: {
        id: string;
        role: "user" | "assistant";
        content: string;
        created_at: string;
    }[];
    collector: {
        currentQuestionKey: SpecQuestionKey | null;
        buffer: string[];
    };
};
export declare function createSession(userId?: number | null): {
    sessionId: string;
    state: SessionState;
};
export declare function getSession(id: string): SessionRecord;
export type ProcessMessageResponse = {
    accepted: false;
    state: SessionState;
    nextQuestion: string;
    done: false;
    error: string;
    spec: Record<string, unknown>;
} | {
    accepted: true;
    state: SessionState;
    nextQuestion: string;
    done: boolean;
    spec: Record<string, unknown>;
    patch: JsonPatchOp[];
};
export declare function processSessionMessage(sessionId: string, message: string): ProcessMessageResponse;
export type GenerateFromSessionResponse = {
    activityId: string;
    problems: GeneratedProblem[];
};
/**
 * Trigger generation for a READY session.
 *
 * Flow:
 * 1. Assert session.state === READY
 * 2. Transition to GENERATING
 * 3. Parse and validate ActivitySpec
 * 4. Derive ProblemPlan
 * 5. Generate problems (per-slot with retries)
 * 6. Persist plan_json + problems_json
 * 7. Create Activity record
 * 8. Transition to SAVED
 * 9. Return activityId
 *
 * On error:
 * - Transition to FAILED
 * - Set last_error
 */
export declare function generateFromSession(sessionId: string, userId: number): Promise<GenerateFromSessionResponse>;
//# sourceMappingURL=sessionService.d.ts.map