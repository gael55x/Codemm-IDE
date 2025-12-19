import crypto from "crypto";
import { sessionDb, sessionMessageDb, activityDb, sessionCollectorDb } from "../database";
import { canTransition, type SessionState } from "../contracts/session";
import { applyJsonPatch, type JsonPatchOp } from "../compiler/jsonPatch";
import { ActivitySpecSchema, type ActivitySpec } from "../contracts/activitySpec";
import { isLanguageSupportedForGeneration } from "../languages/profiles";
import { deriveProblemPlan } from "../planner";
import { generateProblemsFromPlan } from "../generation";
import type { GeneratedProblem } from "../contracts/problem";
import type { SpecDraft } from "../compiler/specDraft";
import { ensureFixedFields } from "../compiler/specDraft";
import { trace, traceText } from "../utils/trace";
import { withTraceContext } from "../utils/traceContext";
import { resolveIntentWithLLM } from "../agent/intentResolver";
import type { IntentResolutionOutput } from "../agent/intentResolver";
import { computeReadiness, type ConfidenceMap } from "../agent/readiness";
import { generateNextPrompt } from "../agent/promptGenerator";
import { getDynamicQuestionKey } from "../agent/questionKey";
import { proposeGenerationFallback } from "../agent/generationFallback";
import { GenerationSlotFailureError } from "../generation/errors";
import { type DialogueUpdate, USER_EDITABLE_SPEC_KEYS, type UserEditableSpecKey } from "../agent/dialogue";
import { publishGenerationProgress } from "../generation/progressBus";
import type { GenerationProgressEvent } from "../contracts/generationProgress";

export type SessionRecord = {
  id: string;
  state: SessionState;
  spec: Record<string, unknown>;
  messages: { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
  collector: { currentQuestionKey: string | null; buffer: string[] };
  confidence: Record<string, number>;
  intentTrace: unknown[];
};

type SessionCollectorState = {
  currentQuestionKey: string | null;
  buffer: string[];
};

function parseJsonObject(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return {};
}

function parseJsonArray(json: string | null | undefined): unknown[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

function mergeConfidence(
  existing: ConfidenceMap,
  incoming: Record<string, number>
): ConfidenceMap {
  const next: ConfidenceMap = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    next[k] = Math.max(0, Math.min(1, v));
  }
  return next;
}

function appendIntentTrace(existing: unknown[], entry: unknown, maxEntries: number = 200): unknown[] {
  const next = [...existing, entry];
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
}

function jsonStable(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function computeDialogueUpdate(args: {
  previous: SpecDraft;
  next: SpecDraft;
  output?: IntentResolutionOutput | null;
}): DialogueUpdate | null {
  const changed: DialogueUpdate["changed"] = {};
  const added: UserEditableSpecKey[] = [];
  const removed: UserEditableSpecKey[] = [];

  for (const key of USER_EDITABLE_SPEC_KEYS) {
    const before = (args.previous as any)[key] as unknown;
    const after = (args.next as any)[key] as unknown;

    const beforeExists = before !== undefined;
    const afterExists = after !== undefined;

    if (beforeExists && !afterExists) {
      removed.push(key);
      continue;
    }
    if (!beforeExists && afterExists) {
      added.push(key);
      continue;
    }
    if (beforeExists && afterExists && jsonStable(before) !== jsonStable(after)) {
      changed[key] = { from: before, to: after };
    }
  }

  const outputInvalidates = args.output?.revision?.invalidates ?? [];
  const invalidated = removed.filter((k) => (outputInvalidates as string[]).includes(k));

  const hasAny =
    Object.keys(changed).length > 0 || added.length > 0 || removed.length > 0 || invalidated.length > 0;
  if (!hasAny) return null;

  return { changed, added, removed, invalidated };
}

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

  const fixed = ensureFixedFields({} as SpecDraft);
  const initialSpec = fixed.length > 0 ? applyJsonPatch({} as any, fixed) : {};

  // Contract allows null or {} — DB column is NOT NULL, so we store {}.
  sessionDb.create(id, state, JSON.stringify(initialSpec), userId ?? null);
  const initialQuestionKey = getDynamicQuestionKey(initialSpec as SpecDraft, {});
  sessionCollectorDb.upsert(id, initialQuestionKey, []);

  return { sessionId: id, state };
}

export function getSession(id: string): SessionRecord {
  const s = requireSession(id);
  const messages = sessionMessageDb.findBySessionId(id);
  const spec = parseSpecJson(s.spec_json);
  const confidence = parseJsonObject(s.confidence_json) as Record<string, number>;
  const collector = getCollectorState(id, getDynamicQuestionKey(spec as SpecDraft, confidence as any));
  const intentTrace = parseJsonArray(s.intent_trace_json).slice(-50);

  return {
    id: s.id,
    state: s.state as SessionState,
    spec,
    messages,
    collector,
    confidence,
    intentTrace,
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

export async function processSessionMessage(
  sessionId: string,
  message: string
): Promise<ProcessMessageResponse> {
  return withTraceContext({ sessionId }, async () => {
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
  const existingConfidence = parseJsonObject(s.confidence_json) as ConfidenceMap;

  // Always persist user message.
  sessionMessageDb.create(crypto.randomUUID(), sessionId, "user", message);

  const fixed = ensureFixedFields(currentSpec as SpecDraft);
  const specWithFixed = fixed.length > 0 ? applyJsonPatch(currentSpec as any, fixed) : currentSpec;
  trace("session.spec.fixed", { sessionId, fixedOps: fixed.map((op) => op.path) });

  const expectedQuestionKey = getDynamicQuestionKey(specWithFixed as SpecDraft, existingConfidence);
  const collector = getCollectorState(sessionId, expectedQuestionKey);
  const updatedBuffer = [...collector.buffer, message];
  persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: updatedBuffer });

  const combined = updatedBuffer.join(" ").trim();
  traceText("session.message.combined", combined, { extra: { sessionId, bufferLen: updatedBuffer.length } });
  const existingTrace = parseJsonArray(s.intent_trace_json);
  let effectiveConfidence: ConfidenceMap = { ...existingConfidence };

  const resolved = await resolveIntentWithLLM({
    userMessage: combined,
    currentSpec: specWithFixed as SpecDraft,
  }).catch((e) => ({ kind: "error" as const, error: e?.message ?? String(e) }));

  if ("output" in resolved && resolved.output) {
    const output = resolved.output as IntentResolutionOutput;
    const nextConfidence = mergeConfidence(existingConfidence, output.confidence ?? {});
    effectiveConfidence = nextConfidence;
    const nextTrace = appendIntentTrace(existingTrace, {
      ts: new Date().toISOString(),
      userMessage: combined,
      output,
      result: resolved.kind,
    });
    sessionDb.updateConfidenceJson(sessionId, JSON.stringify(nextConfidence));
    sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
    existingTrace.splice(0, existingTrace.length, ...nextTrace);
    trace("session.intent.persisted", {
      sessionId,
      confidenceKeys: Object.keys(nextConfidence),
      traceLen: nextTrace.length,
    });
  }

  if (resolved.kind === "clarify") {
    const assistantText = resolved.question;
    sessionMessageDb.create(crypto.randomUUID(), sessionId, "assistant", assistantText);

    sessionDb.updateSpecJson(sessionId, JSON.stringify(specWithFixed));
    persistCollectorState(sessionId, {
      currentQuestionKey: getDynamicQuestionKey(specWithFixed as SpecDraft, effectiveConfidence),
      buffer: [],
    });

    const target: SessionState = "CLARIFYING";
    transitionOrThrow(state, target);
    sessionDb.updateState(sessionId, target);

    return {
      accepted: true,
      state: target,
      nextQuestion: assistantText,
      done: false,
      spec: specWithFixed,
      patch: fixed,
    };
  }

  if (resolved.kind === "patch") {
    const nextSpec = resolved.merged as Record<string, unknown>;
    sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));

    const readiness = computeReadiness(resolved.merged, effectiveConfidence);
    trace("session.readiness", {
      sessionId,
      schemaComplete: readiness.gaps.complete,
      ready: readiness.ready,
      minConfidence: readiness.minConfidence,
      lowConfidenceFields: readiness.lowConfidenceFields,
      missing: readiness.gaps.missing,
    });

    const done = readiness.ready;
    const dialogueUpdate = computeDialogueUpdate({
      previous: specWithFixed as SpecDraft,
      next: resolved.merged,
      output: resolved.output ?? null,
    });

    if (dialogueUpdate) {
      const nextTrace = appendIntentTrace(existingTrace, {
        ts: new Date().toISOString(),
        type: "dialogue_revision",
        update: dialogueUpdate,
        patch: resolved.patch,
      });
      sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
      existingTrace.splice(0, existingTrace.length, ...nextTrace);
    }

    const nextQuestion = generateNextPrompt({
      spec: resolved.merged,
      readiness,
      confidence: effectiveConfidence,
      lastUserMessage: combined,
      dialogueUpdate,
    });

    sessionMessageDb.create(crypto.randomUUID(), sessionId, "assistant", nextQuestion);
    persistCollectorState(sessionId, {
      currentQuestionKey: getDynamicQuestionKey(resolved.merged, effectiveConfidence),
      buffer: [],
    });

    if (!done) {
      const target: SessionState = "CLARIFYING";
      transitionOrThrow(state, target);
      sessionDb.updateState(sessionId, target);
      return {
        accepted: true,
        state: target,
        nextQuestion,
        done: false,
        spec: nextSpec,
        patch: [...fixed, ...resolved.patch],
      };
    }

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
      nextQuestion,
      done: true,
      spec: nextSpec,
      patch: [...fixed, ...resolved.patch],
    };
  }

  // LLM returned noop/error: fall back to deterministic "what's missing next" prompt.
  trace("session.intent.fallback", { sessionId, kind: resolved.kind });
  const readiness = computeReadiness(specWithFixed as SpecDraft, effectiveConfidence);
  const nextQuestion = generateNextPrompt({
    spec: specWithFixed as SpecDraft,
    readiness,
    confidence: effectiveConfidence,
    lastUserMessage: combined,
  });

  sessionMessageDb.create(crypto.randomUUID(), sessionId, "assistant", nextQuestion);
  persistCollectorState(sessionId, {
    currentQuestionKey: getDynamicQuestionKey(specWithFixed as SpecDraft, effectiveConfidence),
    buffer: [],
  });

  if (!readiness.ready) {
    const target: SessionState = "CLARIFYING";
    transitionOrThrow(state, target);
    sessionDb.updateState(sessionId, target);
    return {
      accepted: true,
      state: target,
      nextQuestion,
      done: false,
      spec: specWithFixed,
      patch: fixed,
    };
  }

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
      nextQuestion,
      done: true,
      spec: specWithFixed,
      patch: fixed,
    };
  });
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
  return withTraceContext({ sessionId }, async () => {
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

  const existingTrace = parseJsonArray(s.intent_trace_json);
  const existingConfidence = parseJsonObject(s.confidence_json) as ConfidenceMap;

  const persistTraceEvent = (entry: Record<string, unknown>) => {
    const nextTrace = appendIntentTrace(existingTrace, entry);
    sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
    // Mutate local reference so multiple events in this call don't clobber each other.
    existingTrace.splice(0, existingTrace.length, ...nextTrace);
  };

  const persistConfidencePatch = (patch: JsonPatchOp[]) => {
    const incoming: Record<string, number> = {};
    for (const op of patch) {
      const key = op.path.startsWith("/") ? op.path.slice(1) : op.path;
      if (!key) continue;
      // System-made adjustments are deterministic; mark as high confidence.
      incoming[key] = 1;
    }
    const next = mergeConfidence(existingConfidence, incoming);
    sessionDb.updateConfidenceJson(sessionId, JSON.stringify(next));
    Object.assign(existingConfidence, next);
  };

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
    let spec: ActivitySpec = specResult.data;
    if (!isLanguageSupportedForGeneration(spec.language)) {
      throw new Error(`Language "${spec.language}" is not supported for generation yet.`);
    }

    let problems: GeneratedProblem[] | null = null;
    let usedFallback = false;

    for (let attempt = 0; attempt < 2 && !problems; attempt++) {
      // Derive ProblemPlan (always from current spec)
      const plan = deriveProblemPlan(spec);
      sessionDb.setPlanJson(sessionId, JSON.stringify(plan));
      publishGenerationProgress(sessionId, {
        type: "generation_started",
        totalProblems: plan.length,
        run: attempt + 1,
      });

      try {
        // Generate problems (per-slot with retries + Docker validation + discard reference_solution)
        problems = await generateProblemsFromPlan(plan, {
          onProgress: (event: GenerationProgressEvent) => publishGenerationProgress(sessionId, event),
        });
      } catch (err: any) {
        if (err instanceof GenerationSlotFailureError) {
          persistTraceEvent({
            ts: new Date().toISOString(),
            type: "generation_failure",
            slotIndex: err.slotIndex,
            kind: err.kind,
            attempts: err.attempts,
            title: err.title ?? null,
            llmOutputHash: err.llmOutputHash ?? null,
            message: err.message,
          });

          trace("generation.failure.persisted", {
            sessionId,
            slotIndex: err.slotIndex,
            kind: err.kind,
            llmOutputHash: err.llmOutputHash,
          });

          if (!usedFallback) {
            const decision = proposeGenerationFallback(spec);
            if (decision) {
              usedFallback = true;

              persistTraceEvent({
                ts: new Date().toISOString(),
                type: "generation_soft_fallback",
                reason: decision.reason,
                patch: decision.patch,
              });

              persistConfidencePatch(decision.patch);

              const adjusted = applyJsonPatch(spec as any, decision.patch) as ActivitySpec;
              const adjustedRes = ActivitySpecSchema.safeParse(adjusted);
              if (!adjustedRes.success) {
                persistTraceEvent({
                  ts: new Date().toISOString(),
                  type: "generation_soft_fallback_failed",
                  reason: "fallback patch produced invalid ActivitySpec",
                  error: adjustedRes.error.issues[0]?.message ?? "invalid",
                });
                throw err;
              }

              spec = adjustedRes.data;
              sessionDb.updateSpecJson(sessionId, JSON.stringify(spec));
              continue;
            }
          }
        }

        throw err;
      }
    }

    if (!problems) {
      throw new Error("Generation failed: problems were not produced.");
    }

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
    publishGenerationProgress(sessionId, { type: "generation_complete", activityId });

    if (usedFallback) {
      persistTraceEvent({
        ts: new Date().toISOString(),
        type: "generation_soft_fallback_succeeded",
      });
    }

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

      publishGenerationProgress(sessionId, {
        type: "generation_failed",
        error: "Generation failed. Please try again.",
      });
      throw err;
    }
  });
}
