import crypto from "crypto";
import { sessionDb, sessionMessageDb, activityDb, sessionCollectorDb } from "../database";
import { canTransition, type SessionState } from "../contracts/session";
import { getNextQuestion, specBuilderStep, type SpecBuilderResult } from "../specBuilder";
import { nextSlotKey } from "../specBuilder/intent";
import { applyJsonPatch, type JsonPatchOp } from "../specBuilder/patch";
import { ActivitySpecSchema, type ActivitySpec } from "../contracts/activitySpec";
import { deriveProblemPlan } from "../planner";
import { generateProblemsFromPlan } from "../generation";
import type { GeneratedProblem } from "../contracts/problem";
import type { SpecDraft } from "../specBuilder/validators";
import { ensureFixedFields, isSpecComplete, validatePatchedSpecOrError } from "../specBuilder/validators";
import { interpretIntent } from "../intentInterpreter";
import { trace, traceText } from "../utils/trace";

export type SessionRecord = {
  id: string;
  state: SessionState;
  spec: Record<string, unknown>;
  messages: { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
  collector: { currentQuestionKey: string | null; buffer: string[] };
};

type SessionCollectorState = {
  currentQuestionKey: string | null;
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
  expectedQuestionKey: string | null
): SessionCollectorState {
  const existing = sessionCollectorDb.findBySessionId(sessionId);
  if (!existing) {
    return persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: [] });
  }

  const buffer = parseCollectorBuffer(existing.buffer_json);
  const storedKey = (existing.current_question_key as string | null) ?? null;

  if (storedKey !== expectedQuestionKey) {
    return persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: [] });
  }

  return { currentQuestionKey: storedKey, buffer };
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
  const initialQuestionKey = nextSlotKey({} as SpecDraft);
  sessionCollectorDb.upsert(id, initialQuestionKey, []);

  return { sessionId: id, state };
}

export function getSession(id: string): SessionRecord {
  const s = requireSession(id);
  const messages = sessionMessageDb.findBySessionId(id);
  const spec = parseSpecJson(s.spec_json);
  const collector = getCollectorState(id, nextSlotKey(spec as SpecDraft));

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
  trace("session.message.start", { sessionId, state });
  traceText("session.message.user", message, { extra: { sessionId } });

  if (state !== "DRAFT" && state !== "CLARIFYING") {
    const err = new Error(`Cannot post messages when session state is ${state}.`);
    (err as any).status = 409;
    throw err;
  }

  const currentSpec = parseSpecJson(s.spec_json);
  const currentQuestionKey = nextSlotKey(currentSpec as SpecDraft);

  // Always persist user message.
  sessionMessageDb.create(crypto.randomUUID(), sessionId, "user", message);

  const collector = getCollectorState(sessionId, currentQuestionKey);
  const updatedBuffer = [...collector.buffer, message];
  persistCollectorState(sessionId, { currentQuestionKey, buffer: updatedBuffer });

  const combined = updatedBuffer.join(" ").trim();
  traceText("session.message.combined", combined, { extra: { sessionId, bufferLen: updatedBuffer.length } });
  const fixed = ensureFixedFields(currentSpec as SpecDraft);
  const specWithFixed = fixed.length > 0 ? applyJsonPatch(currentSpec as any, fixed) : currentSpec;
  trace("session.spec.fixed", { sessionId, fixedOps: fixed.map((op) => op.path) });

  const interpreted = interpretIntent(specWithFixed as SpecDraft, combined);
  trace("session.intent", { sessionId, kind: interpreted.kind });

  if (interpreted.kind === "conflict") {
    // Persist assistant clarification.
    const content = interpreted.message;
    sessionMessageDb.create(crypto.randomUUID(), sessionId, "assistant", content);

    // Persist fixed invariants (safe side-effect, improves UX on repeated clarifications).
    if (fixed.length > 0) {
      sessionDb.updateSpecJson(sessionId, JSON.stringify(specWithFixed));
    }

    // Reset buffer; treat this as a new question turn.
    persistCollectorState(sessionId, {
      currentQuestionKey: nextSlotKey(specWithFixed as SpecDraft),
      buffer: [],
    });

    // Transition into CLARIFYING (agent asked a follow-up).
    const target: SessionState = "CLARIFYING";
    transitionOrThrow(state, target);
    sessionDb.updateState(sessionId, target);

    return {
      accepted: true,
      state: target,
      nextQuestion: content,
      done: false,
      spec: specWithFixed,
      patch: fixed,
    };
  }

  if (interpreted.kind === "patch") {
    trace("session.intent.patch", { sessionId, ops: interpreted.patch.map((op) => op.path) });
    const nextSpecCandidate = applyJsonPatch(specWithFixed as any, interpreted.patch);
    const contractError = validatePatchedSpecOrError(nextSpecCandidate as SpecDraft);

    if (contractError) {
      trace("session.intent.contract_error", { sessionId, error: contractError });
      const nextQuestion = getNextQuestion(specWithFixed as SpecDraft);
      sessionMessageDb.create(
        crypto.randomUUID(),
        sessionId,
        "assistant",
        `${contractError}\n\n${nextQuestion}`
      );

      return {
        accepted: false,
        state,
        nextQuestion,
        done: false,
        error: contractError,
        spec: specWithFixed,
      };
    }

    const nextSpec = nextSpecCandidate as Record<string, unknown>;
    const done = isSpecComplete(nextSpecCandidate as SpecDraft);
    const nextQuestion = done
      ? "Spec looks complete. You can generate the activity."
      : getNextQuestion(nextSpecCandidate as SpecDraft);
    trace("session.intent.applied", { sessionId, done });

    const summaryPrefix =
      interpreted.summaryLines.length >= 2
        ? `Got it: ${interpreted.summaryLines.join("; ")}\n\n`
        : "";
    const assistantText = `${summaryPrefix}${nextQuestion}`;

    sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));

    sessionMessageDb.create(
      crypto.randomUUID(),
      sessionId,
      "assistant",
      assistantText
    );

    persistCollectorState(sessionId, {
      currentQuestionKey: nextSlotKey(nextSpecCandidate as SpecDraft),
      buffer: [],
    });

    const patch: JsonPatchOp[] = [...fixed, ...interpreted.patch];

    if (!done) {
      const target: SessionState = "CLARIFYING";
      transitionOrThrow(state, target);
      sessionDb.updateState(sessionId, target);

      return {
        accepted: true,
        state: target,
        nextQuestion: assistantText,
        done: false,
        spec: nextSpec,
        patch,
      };
    }

    // done === true
    if (state === "DRAFT") {
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
      nextQuestion: assistantText,
      done: true,
      spec: nextSpec,
      patch,
    };
  }

  // Legacy deterministic step (single-slot parsing).
  // Note: pass the persisted spec so the returned patch reflects the actual mutation (includes fixed fields).
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
      spec: specWithFixed,
    };
  }

  const patch = result.patch ?? [];
  const nextSpec = applyJsonPatch(currentSpec as any, patch);

  sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));

  const nextQuestion = result.nextQuestion;
  sessionMessageDb.create(crypto.randomUUID(), sessionId, "assistant", nextQuestion);
  persistCollectorState(sessionId, { currentQuestionKey: nextSlotKey(nextSpec as SpecDraft), buffer: [] });

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
