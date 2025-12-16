import crypto from "crypto";
import { sessionDb, sessionMessageDb, activityDb } from "../database";
import { canTransition, type SessionState } from "../contracts/session";
import { specBuilderStep, type SpecBuilderResult } from "../specBuilder";
import { applyJsonPatch, type JsonPatchOp } from "../specBuilder/patch";
import { ActivitySpecSchema, type ActivitySpec } from "../contracts/activitySpec";
import { deriveProblemPlan } from "../planner";
import { generateProblemsFromPlan } from "../generation";
import type { GeneratedProblem } from "../contracts/problem";

export type SessionRecord = {
  id: string;
  state: SessionState;
  spec: Record<string, unknown>;
  messages: { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
};

function requireSession(id: string) {
  const session = sessionDb.findById(id);
  if (!session) {
    const err = new Error("Session not found");
    (err as any).status = 404;
    throw err;
  }
  return session;
}

function parseSpecJson(specJson: string): Record<string, unknown> {
  if (!specJson || !specJson.trim()) return {};
  try {
    const parsed = JSON.parse(specJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function transitionOrThrow(from: SessionState, to: SessionState) {
  if (from === to) return;
  if (!canTransition(from, to)) {
    const err = new Error(`Invalid session state transition: ${from} -> ${to}`);
    (err as any).status = 409;
    throw err;
  }
}

export function createSession(userId?: number | null): { sessionId: string; state: SessionState } {
  const id = crypto.randomUUID();
  const state: SessionState = "DRAFT";

  // Contract allows null or {} — DB column is NOT NULL, so we store {}.
  sessionDb.create(id, state, "{}", userId ?? null);

  return { sessionId: id, state };
}

export function getSession(id: string): SessionRecord {
  const s = requireSession(id);
  const messages = sessionMessageDb.findBySessionId(id);

  return {
    id: s.id,
    state: s.state as SessionState,
    spec: parseSpecJson(s.spec_json),
    messages,
  };
}

export type ProcessMessageResponse =
  | {
      accepted: false;
      state: SessionState;
      nextQuestion: string;
      done: false;
      error: string;
      spec: Record<string, unknown>;
    }
  | {
      accepted: true;
      state: SessionState;
      nextQuestion: string;
      done: boolean;
      spec: Record<string, unknown>;
      patch: JsonPatchOp[];
    };

export function processSessionMessage(sessionId: string, message: string): ProcessMessageResponse {
  const s = requireSession(sessionId);
  const state = s.state as SessionState;

  if (state !== "DRAFT" && state !== "CLARIFYING") {
    const err = new Error(`Cannot post messages when session state is ${state}.`);
    (err as any).status = 409;
    throw err;
  }

  const currentSpec = parseSpecJson(s.spec_json);

  const result: SpecBuilderResult = specBuilderStep(currentSpec as any, message);

  // Always persist user message.
  sessionMessageDb.create(crypto.randomUUID(), sessionId, "user", message);

  if (!result.accepted) {
    const error = result.error ?? "Invalid answer.";
    const nextQuestion = result.nextQuestion;

    // Persist assistant message re-asking the same question (with error context).
    sessionMessageDb.create(
      crypto.randomUUID(),
      sessionId,
      "assistant",
      `${error}\n\n${nextQuestion}`
    );

    // Do NOT mutate spec.
    // Do NOT transition state.

    return {
      accepted: false,
      state,
      nextQuestion,
      done: false,
      error,
      spec: currentSpec,
    };
  }

  const patch = result.patch ?? [];
  const nextSpec = applyJsonPatch(currentSpec as any, patch);

  sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));

  const nextQuestion = result.nextQuestion;
  sessionMessageDb.create(crypto.randomUUID(), sessionId, "assistant", nextQuestion);

  // Update session state (strict transitions)
  if (!result.done) {
    // DRAFT -> CLARIFYING, CLARIFYING -> CLARIFYING
    const target: SessionState = "CLARIFYING";
    transitionOrThrow(state, target);
    sessionDb.updateState(sessionId, target);

    return {
      accepted: true,
      state: target,
      nextQuestion,
      done: false,
      spec: nextSpec,
      patch,
    };
  }

  // done === true
  if (state === "DRAFT") {
    // Only DRAFT -> CLARIFYING is allowed directly. Then CLARIFYING -> READY.
    transitionOrThrow("DRAFT", "CLARIFYING");
    sessionDb.updateState(sessionId, "CLARIFYING");
    transitionOrThrow("CLARIFYING", "READY");
    sessionDb.updateState(sessionId, "READY");
  } else {
    transitionOrThrow(state, "READY");
    sessionDb.updateState(sessionId, "READY");
  }

  return {
    accepted: true,
    state: "READY",
    nextQuestion,
    done: true,
    spec: nextSpec,
    patch,
  };
}

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
export async function generateFromSession(
  sessionId: string,
  userId: number
): Promise<GenerateFromSessionResponse> {
  const s = requireSession(sessionId);
  const state = s.state as SessionState;

  if (state !== "READY") {
    const err = new Error(`Cannot generate when session state is ${state}. Expected READY.`);
    (err as any).status = 409;
    throw err;
  }

  // Guard: reject if problems already generated (prevent accidental re-generation)
  if (s.problems_json && s.problems_json.trim()) {
    const err = new Error("Session already has generated problems. Cannot re-generate.");
    (err as any).status = 409;
    throw err;
  }

  try {
    // Transition to GENERATING (lock)
    transitionOrThrow(state, "GENERATING");
    sessionDb.updateState(sessionId, "GENERATING");

    // Parse and validate ActivitySpec
    const specObj = parseSpecJson(s.spec_json);
    const specResult = ActivitySpecSchema.safeParse(specObj);
    if (!specResult.success) {
      throw new Error(
        `Invalid ActivitySpec: ${specResult.error.issues[0]?.message ?? "validation failed"}`
      );
    }
    const spec: ActivitySpec = specResult.data;

    // Derive ProblemPlan
    const plan = deriveProblemPlan(spec);
    sessionDb.setPlanJson(sessionId, JSON.stringify(plan));

    // Generate problems (per-slot with retries + Docker validation + discard reference_solution)
    const problems = await generateProblemsFromPlan(plan);

    // Persist problems_json
    sessionDb.setProblemsJson(sessionId, JSON.stringify(problems));

    // Create Activity record
    const activityId = crypto.randomUUID();
    const activityTitle = `Activity (${spec.problem_count} problems)`;

    activityDb.create(activityId, userId, activityTitle, JSON.stringify(problems), undefined);

    // Link activity to session
    sessionDb.setActivityId(sessionId, activityId);

    // Transition to SAVED
    transitionOrThrow("GENERATING", "SAVED");
    sessionDb.updateState(sessionId, "SAVED");

    return { activityId, problems };
  } catch (err: any) {
    // Transition to FAILED
    try {
      transitionOrThrow("GENERATING", "FAILED");
      sessionDb.updateState(sessionId, "FAILED");
      sessionDb.setLastError(sessionId, err.message ?? "Unknown error during generation.");
    } catch (transitionErr) {
      console.error("Failed to transition session to FAILED:", transitionErr);
    }

    throw err;
  }
}
