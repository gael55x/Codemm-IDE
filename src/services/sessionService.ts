import crypto from "crypto";
import { sessionDb, sessionMessageDb, activityDb, sessionCollectorDb } from "../database";
import { canTransition, type SessionState } from "../contracts/session";
import { specBuilderStep, getNextQuestionKey, type SpecBuilderResult } from "../specBuilder";
import { applyJsonPatch, type JsonPatchOp } from "../specBuilder/patch";
import { ActivitySpecSchema, type ActivitySpec } from "../contracts/activitySpec";
import { deriveProblemPlan } from "../planner";
import { generateProblemsFromPlan } from "../generation";
import type { GeneratedProblem } from "../contracts/problem";
import { QUESTIONS, type SpecQuestionKey } from "../specBuilder/questions";
import { checkAnswerCompleteness } from "../specBuilder/completeness";
import type { SpecDraft } from "../specBuilder/validators";

export type SessionRecord = {
  id: string;
  state: SessionState;
  spec: Record<string, unknown>;
  messages: { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
  collector: { currentQuestionKey: SpecQuestionKey | null; buffer: string[] };
};

type SessionCollectorState = {
  currentQuestionKey: SpecQuestionKey | null;
  buffer: string[];
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

function parseCollectorBuffer(bufferJson: string | null | undefined): string[] {
  if (!bufferJson) return [];
  try {
    const parsed = JSON.parse(bufferJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // ignore parse errors and reset to empty buffer
  }
  return [];
}

function persistCollectorState(sessionId: string, state: SessionCollectorState): SessionCollectorState {
  sessionCollectorDb.upsert(sessionId, state.currentQuestionKey, state.buffer);
  return state;
}

function getCollectorState(
  sessionId: string,
  expectedQuestionKey: SpecQuestionKey | null
): SessionCollectorState {
  const existing = sessionCollectorDb.findBySessionId(sessionId);
  if (!existing) {
    return persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: [] });
  }

  const buffer = parseCollectorBuffer(existing.buffer_json);
  const storedKey = (existing.current_question_key as SpecQuestionKey | null) ?? null;

  if (storedKey !== expectedQuestionKey) {
    return persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: [] });
  }

  return { currentQuestionKey: storedKey, buffer };
}

function getQuestionText(key: SpecQuestionKey | null): string {
  if (!key) {
    return "Spec looks complete. You can generate the activity.";
  }
  return QUESTIONS[key];
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
  const initialQuestionKey = getNextQuestionKey({} as SpecDraft);
  sessionCollectorDb.upsert(id, initialQuestionKey, []);

  return { sessionId: id, state };
}

export function getSession(id: string): SessionRecord {
  const s = requireSession(id);
  const messages = sessionMessageDb.findBySessionId(id);
  const spec = parseSpecJson(s.spec_json);
  const collector = getCollectorState(id, getNextQuestionKey(spec as SpecDraft));

  return {
    id: s.id,
    state: s.state as SessionState,
    spec,
    messages,
    collector,
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
  const currentQuestionKey = getNextQuestionKey(currentSpec as SpecDraft);
  const currentQuestion = getQuestionText(currentQuestionKey);

  // Always persist user message.
  sessionMessageDb.create(crypto.randomUUID(), sessionId, "user", message);

  const collector = getCollectorState(sessionId, currentQuestionKey);
  const updatedBuffer = [...collector.buffer, message];
  persistCollectorState(sessionId, { currentQuestionKey, buffer: updatedBuffer });

  if (currentQuestionKey) {
    const completeness = checkAnswerCompleteness(
      currentQuestionKey,
      updatedBuffer,
      currentSpec as SpecDraft
    );
    if (!completeness.complete) {
      const missingNote =
        completeness.missing.length > 0
          ? ` Still need: ${completeness.missing.join(", ")}.`
          : "";
      const error = `I'll send this once all required items are present.${missingNote}`;

      sessionMessageDb.create(
        crypto.randomUUID(),
        sessionId,
        "assistant",
        `${error}\n\n${currentQuestion}`
      );

      return {
        accepted: false,
        state,
        nextQuestion: currentQuestion,
        done: false,
        error,
        spec: currentSpec,
      };
    }
  }

  const combined = updatedBuffer.join(" ").trim();
  const result: SpecBuilderResult = specBuilderStep(currentSpec as any, combined);

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
  const nextQuestionKey = getNextQuestionKey(nextSpec as SpecDraft);
  persistCollectorState(sessionId, { currentQuestionKey: nextQuestionKey, buffer: [] });

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
