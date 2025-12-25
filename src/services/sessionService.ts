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
import { ActivitySpecDraftSchema, ensureFixedFields, isSpecCompleteForGeneration } from "../compiler/specDraft";
import { trace, traceText } from "../utils/trace";
import { withTraceContext } from "../utils/traceContext";
import type { ConfidenceMap } from "../agent/readiness";
import { proposeGenerationFallback } from "../agent/generationFallback";
import { GenerationSlotFailureError } from "../generation/errors";
import { USER_EDITABLE_SPEC_KEYS, type UserEditableSpecKey } from "../agent/dialogue";
import { publishGenerationProgress } from "../generation/progressBus";
import type { GenerationProgressEvent } from "../contracts/generationProgress";
import type { GenerationOutcome } from "../contracts/generationOutcome";
import {
  listCommitments,
  parseCommitmentsJson,
  removeCommitment,
  serializeCommitments,
  upsertCommitment,
  type CommitmentStore,
} from "../agent/commitments";
import { DEFAULT_LEARNING_MODE, LearningModeSchema, type LearningMode } from "../contracts/learningMode";
import { getLearnerProfile } from "./learnerProfileService";
import { buildGuidedPedagogyPolicy } from "../planner/pedagogy";
import { logConversationMessage } from "../utils/devLogs";
import { runDialogueTurn } from "./dialogueService";
import { analyzeSpecGaps, defaultNextQuestionFromGaps } from "../agent/specAnalysis";
import { parseDifficultyPlanShorthand } from "../agent/difficultyPlanParser";

export type SessionRecord = {
  id: string;
  state: SessionState;
  learning_mode: LearningMode;
  spec: Record<string, unknown>;
  messages: { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
  collector: { currentQuestionKey: string | null; buffer: string[] };
  confidence: Record<string, number>;
  commitments: ReturnType<typeof listCommitments>;
  generationOutcomes: GenerationOutcome[];
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

function parseStringArray(json: string | null | undefined): string[] {
  const arr = parseJsonArray(json);
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

function parseGenerationOutcomes(json: string | null | undefined): GenerationOutcome[] {
  const parsed = parseJsonArray(json);
  const outcomes: GenerationOutcome[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const slotIndex = (item as any).slotIndex;
    const success = (item as any).success;
    const retries = (item as any).retries;
    const appliedFallback = (item as any).appliedFallback;
    if (typeof slotIndex !== "number" || !Number.isFinite(slotIndex)) continue;
    if (typeof success !== "boolean") continue;
    if (typeof retries !== "number" || !Number.isFinite(retries)) continue;
    outcomes.push({
      slotIndex,
      success,
      retries,
      ...(typeof appliedFallback === "string" && appliedFallback.trim() ? { appliedFallback } : {}),
    });
  }
  return outcomes;
}

function parseLearningMode(raw: unknown): LearningMode {
  const parsed = LearningModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_LEARNING_MODE;
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

function isPureConfirmationMessage(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m) return false;
  if (m.length > 40) return false;
  return (
    m === "y" ||
    m === "yes" ||
    m === "yep" ||
    m === "yeah" ||
    m === "sure" ||
    m === "ok" ||
    m === "okay" ||
    m === "confirm" ||
    m === "confirmed" ||
    m === "looks good" ||
    m === "sounds good" ||
    m === "go ahead" ||
    m === "proceed"
  );
}

type PendingConfirmation = {
  kind: "pending_confirmation";
  fields: UserEditableSpecKey[];
  patch: Record<string, unknown>;
};

function parsePendingConfirmation(buffer: string[]): PendingConfirmation | null {
  if (!Array.isArray(buffer) || buffer.length === 0) return null;
  const raw = buffer[0];
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingConfirmation>;
    if (!parsed || parsed.kind !== "pending_confirmation") return null;
    if (!Array.isArray(parsed.fields) || typeof parsed.patch !== "object" || !parsed.patch) return null;
    const fields = parsed.fields.filter((f): f is UserEditableSpecKey => (USER_EDITABLE_SPEC_KEYS as readonly string[]).includes(String(f)));
    return { kind: "pending_confirmation", fields, patch: parsed.patch as Record<string, unknown> };
  } catch {
    return null;
  }
}

function serializePendingConfirmation(p: PendingConfirmation): string[] {
  return [JSON.stringify(p)];
}

function inferCommitmentSource(args: {
  field: UserEditableSpecKey;
  userMessage: string;
  currentQuestionKey: string | null;
}): "explicit" | "implicit" {
  const msg = args.userMessage.trim().toLowerCase();
  const qk = args.currentQuestionKey;
  const goal = qk?.startsWith("goal:") ? qk.slice("goal:".length) : null;
  const confirm =
    qk?.startsWith("confirm:") ? qk.slice("confirm:".length).split(",").map((s) => s.trim()).filter(Boolean) : null;

  if (qk === args.field) return "explicit";
  if (qk?.startsWith("invalid:") && qk.slice("invalid:".length) === args.field) return "explicit";
  if (confirm?.includes(args.field)) return "explicit";
  if (goal === "content" && args.field === "topic_tags") return "explicit";
  if (goal === "scope" && args.field === "problem_count") return "explicit";
  if (goal === "difficulty" && args.field === "difficulty_plan") return "explicit";
  if (goal === "checking" && args.field === "problem_style") return "explicit";
  if (goal === "language" && args.field === "language") return "explicit";

  if (args.field === "problem_count") {
    if (/(\b\d+\b)\s*(problems|problem|questions|question|exercises|exercise)\b/.test(msg)) return "explicit";
    if (/^(?:i want )?\d+\b/.test(msg)) return "explicit";
  }

  if (args.field === "problem_style") {
    if (/\b(stdout|return|mixed)\b/.test(msg)) return "explicit";
  }

  if (args.field === "difficulty_plan") {
    if (/\b(easy|medium|hard)\b/.test(msg)) return "explicit";
    if (/\b(easy|medium|hard)\s*:\s*\d+\b/.test(msg)) return "explicit";
  }

  if (args.field === "topic_tags") {
    if (qk === "topic_tags") return "explicit";
    if (msg.includes(",") && msg.length <= 200) return "explicit";
    if (/\b(topic|topics|focus on|focus|cover|about)\b/.test(msg)) return "explicit";
  }

  if (args.field === "language") {
    if (/\b(java|python|cpp|sql)\b/.test(msg)) return "explicit";
    if (/(^|[^a-z0-9])c\+\+([^a-z0-9]|$)/.test(msg)) return "explicit";
  }

  return "implicit";
}

function appendIntentTrace(existing: unknown[], entry: unknown, maxEntries: number = 200): unknown[] {
  const next = [...existing, entry];
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
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

function persistCollectorState(sessionId: string, state: SessionCollectorState): SessionCollectorState {
  sessionCollectorDb.upsert(sessionId, state.currentQuestionKey, state.buffer);
  return state;
}

function getCollectorState(sessionId: string): SessionCollectorState {
  const existing = sessionCollectorDb.findBySessionId(sessionId);
  if (!existing) {
    return persistCollectorState(sessionId, { currentQuestionKey: null, buffer: [] });
  }

  const storedKey = (existing.current_question_key as string | null) ?? null;
  const buffer = parseStringArray(existing.buffer_json);
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

export function createSession(
  userId?: number | null,
  learningMode?: LearningMode
): { sessionId: string; state: SessionState; learning_mode: LearningMode } {
  const id = crypto.randomUUID();
  const state: SessionState = "DRAFT";
  const learning_mode: LearningMode = parseLearningMode(learningMode);

  const fixed = ensureFixedFields({} as SpecDraft);
  const initialSpec = fixed.length > 0 ? applyJsonPatch({} as any, fixed) : {};

  // Contract allows null or {} — DB column is NOT NULL, so we store {}.
  sessionDb.create(id, state, learning_mode, JSON.stringify(initialSpec), userId ?? null);
  sessionCollectorDb.upsert(id, null, []);

  return { sessionId: id, state, learning_mode };
}

export function getSession(id: string): SessionRecord {
  const s = requireSession(id);
  const messages = sessionMessageDb.findBySessionId(id);
  const spec = parseSpecJson(s.spec_json);
  const confidence = parseJsonObject(s.confidence_json) as Record<string, number>;
  const commitments = parseCommitmentsJson(s.commitments_json);
  const collector = getCollectorState(id);
  const intentTrace = parseJsonArray(s.intent_trace_json).slice(-50);
  const generationOutcomes = parseGenerationOutcomes(s.generation_outcomes_json);
  const learning_mode = parseLearningMode((s as any).learning_mode);

  return {
    id: s.id,
    state: s.state as SessionState,
    learning_mode,
    spec,
    messages,
    collector,
    confidence,
    commitments: listCommitments(commitments),
    generationOutcomes,
    intentTrace,
  };
}

export type ProcessMessageResponse =
  | {
      accepted: false;
      state: SessionState;
      nextQuestion: string;
      questionKey: string | null;
      done: false;
      error: string;
      spec: Record<string, unknown>;
      assistant_summary?: string;
      assumptions?: string[];
      next_action?: string;
    }
  | {
      accepted: true;
      state: SessionState;
      nextQuestion: string;
      questionKey: string | null;
      done: boolean;
      spec: Record<string, unknown>;
      patch: JsonPatchOp[];
      assistant_summary?: string;
      assumptions?: string[];
      next_action?: string;
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
    let commitmentsStore: CommitmentStore = parseCommitmentsJson(s.commitments_json);

    const persistMessage = (role: "user" | "assistant", content: string) => {
      sessionMessageDb.create(crypto.randomUUID(), sessionId, role, content);
      logConversationMessage({ sessionId, role, content });
    };

    // Always persist user message.
    persistMessage("user", message);

    const fixed = ensureFixedFields(currentSpec as SpecDraft);
    const specWithFixed = fixed.length > 0 ? applyJsonPatch(currentSpec as any, fixed) : currentSpec;
    trace("session.spec.fixed", { sessionId, fixedOps: fixed.map((op) => op.path) });

    const existingTrace = parseJsonArray(s.intent_trace_json);
    let effectiveConfidence: ConfidenceMap = { ...existingConfidence };

    // Ensure the fixed fields are persisted even if the user message doesn't change anything.
    sessionDb.updateSpecJson(sessionId, JSON.stringify(specWithFixed));

	    const historyRows = sessionMessageDb.findBySessionId(sessionId).slice(-30);
	    const history = historyRows.map((m) => ({ role: m.role as any, content: m.content as string }));

	    const collector = getCollectorState(sessionId);
	    const currentQuestionKey = collector.currentQuestionKey;

	    let deterministicPatch: Record<string, unknown> = {};
	    if (currentQuestionKey === "difficulty_plan") {
	      const currentProblemCount = (specWithFixed as any).problem_count;
	      const parsed = parseDifficultyPlanShorthand({
	        text: message,
	        ...(typeof currentProblemCount === "number" && Number.isFinite(currentProblemCount)
	          ? { currentProblemCount }
	          : {}),
	      });
	      if (parsed) {
	        deterministicPatch = parsed.patch as any;
	        trace("session.difficulty_plan.parsed_shorthand", {
	          sessionId,
	          explicitTotal: parsed.explicitTotal,
	          keys: Object.keys(parsed.patch),
	        });
	      }
	    }
	
	    const dialogue = await runDialogueTurn({
	      sessionState: state,
	      currentSpec: specWithFixed as SpecDraft,
	      conversationHistory: history,
	      latestUserMessage: message,
	    });

    const traceEntry = {
      ts: new Date().toISOString(),
      type: "dialogue_turn",
      proposedPatch: dialogue.proposedPatch,
      needsConfirmation: dialogue.needsConfirmation ?? null,
    };
    const nextTrace = appendIntentTrace(existingTrace, traceEntry);
    sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));

	    const pending = parsePendingConfirmation(collector.buffer);
	    const isConfirmKey = typeof currentQuestionKey === "string" && currentQuestionKey.startsWith("confirm:");
	    const userConfirmedPending = Boolean(isConfirmKey && pending && isPureConfirmationMessage(message));
	
	    const proposed: Record<string, unknown> = userConfirmedPending
	      ? pending!.patch
	      : ((dialogue.proposedPatch ?? {}) as Record<string, unknown>);

	    const mergedProposed: Record<string, unknown> =
	      Object.keys(deterministicPatch).length > 0 ? { ...proposed, ...deterministicPatch } : proposed;

    const needsConfirmationFields = userConfirmedPending
      ? []
      : Array.isArray(dialogue.needsConfirmation)
      ? dialogue.needsConfirmation
      : [];

    if (userConfirmedPending) {
      trace("session.confirmation.resolved", {
        sessionId,
        fields: pending!.fields,
        appliedKeys: Object.keys(pending!.patch ?? {}),
      });
    }

  const buildOpsFromPartial = (base: SpecDraft, partial: Record<string, unknown>): JsonPatchOp[] => {
    const ops: JsonPatchOp[] = [];
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) continue;
      const path = `/${k}`;
      const exists = Object.prototype.hasOwnProperty.call(base, k) && (base as any)[k] !== undefined;
      ops.push({ op: exists ? "replace" : "add", path, value: v });
    }
    return ops;
  };

  const buildNextQuestion = (spec: SpecDraft): { key: string; prompt: string } | null => {
    const gaps = analyzeSpecGaps(spec);
    if (gaps.complete) return null;
    const prompt = defaultNextQuestionFromGaps(gaps);
    const priority: (keyof ActivitySpec)[] = ["language", "problem_count", "difficulty_plan", "topic_tags", "problem_style"];
    const next = priority.find((k) => gaps.missing.includes(k)) ?? (gaps.missing[0] as keyof ActivitySpec | undefined);
    return { key: next ? String(next) : "unknown", prompt };
  };

		  if (needsConfirmationFields.length > 0) {
		    const fields = needsConfirmationFields.slice().sort();
		    const nextKey = dialogue.nextQuestion?.key ?? `confirm:${fields.join(",")}`;
		    const prompt = dialogue.nextQuestion?.prompt ?? "Confirm the change you want to make.";
		    const assistantText = [dialogue.assistantMessage, prompt].filter(Boolean).join("\n\n");
		
		    const pendingConfirm: PendingConfirmation = {
		      kind: "pending_confirmation",
		      fields: fields as UserEditableSpecKey[],
		      patch: mergedProposed,
		    };

	      trace("session.confirmation.pending", {
	        sessionId,
	        fields,
	        candidateKeys: Object.keys(mergedProposed ?? {}),
	      });
	
	    persistMessage("assistant", assistantText);
	    persistCollectorState(sessionId, { currentQuestionKey: nextKey, buffer: serializePendingConfirmation(pendingConfirm) });

    const target: SessionState = "CLARIFYING";
    transitionOrThrow(state, target);
    sessionDb.updateState(sessionId, target);

    return {
      accepted: true,
      state: target,
      nextQuestion: assistantText,
      questionKey: nextKey,
      done: false,
      spec: specWithFixed,
      patch: fixed,
      next_action: "confirm",
    };
  }

  // Apply the proposed patch deterministically (and never persist invalid fields).
  let appliedUserOps: JsonPatchOp[] = [];
  let nextSpec: SpecDraft = specWithFixed as SpecDraft;
	  const userOps = buildOpsFromPartial(specWithFixed as SpecDraft, mergedProposed as any);

  const applyWithDraftValidation = (ops: JsonPatchOp[]) => {
    const merged = ops.length > 0 ? (applyJsonPatch(specWithFixed as any, ops) as SpecDraft) : (specWithFixed as SpecDraft);
    const fixedAfter = ensureFixedFields(merged);
    const final = fixedAfter.length > 0 ? (applyJsonPatch(merged as any, fixedAfter) as SpecDraft) : merged;
    return { final, fixedAfter };
  };

	  if (userOps.length > 0) {
	    const candidate = applyWithDraftValidation(userOps);
	    const res = ActivitySpecDraftSchema.safeParse(candidate.final);
	    if (res.success) {
	      nextSpec = candidate.final;
	      appliedUserOps = userOps;
	    } else {
      // Deterministic repair: drop invalid fields once.
      const invalidKeys = Array.from(
        new Set(res.error.issues.map((i) => (i.path?.[0] != null ? String(i.path[0]) : "")))
      ).filter(Boolean);
      const filtered: Record<string, unknown> = { ...(proposed as any) };
      for (const k of invalidKeys) delete filtered[k];
      const ops2 = buildOpsFromPartial(specWithFixed as SpecDraft, filtered);
      const candidate2 = applyWithDraftValidation(ops2);
      const res2 = ActivitySpecDraftSchema.safeParse(candidate2.final);
      if (res2.success) {
        nextSpec = candidate2.final;
        appliedUserOps = ops2;
      } else {
        nextSpec = specWithFixed as SpecDraft;
        appliedUserOps = [];
	      }
	    }
	  }

    trace("session.spec.user_patch_applied", {
      sessionId,
      appliedOps: appliedUserOps.map((op) => op.path),
    });
	
	  sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));

  // Treat accepted fields as high confidence (deterministic; hard-field confirmation is separate).
  for (const op of appliedUserOps) {
    const key = op.path.startsWith("/") ? op.path.slice(1) : op.path;
    if (!key) continue;
    effectiveConfidence[key] = 1;
  }
  sessionDb.updateConfidenceJson(sessionId, JSON.stringify(effectiveConfidence));

  // Update commitments for any accepted user-editable fields and clear commitments for invalidated removals.
  for (const op of appliedUserOps) {
    if (!op.path.startsWith("/")) continue;
    const key = op.path.slice(1) as UserEditableSpecKey;
    if (!(USER_EDITABLE_SPEC_KEYS as readonly string[]).includes(key)) continue;

    if (op.op === "remove") {
      commitmentsStore = removeCommitment(commitmentsStore, key as any);
      continue;
    }

    const value = (nextSpec as any)[key];
    const source = inferCommitmentSource({ field: key, userMessage: message, currentQuestionKey });
    commitmentsStore = upsertCommitment(commitmentsStore, {
      field: key,
      value,
      confidence: 1,
      source,
    });
  }
  sessionDb.updateCommitmentsJson(sessionId, serializeCommitments(commitmentsStore));

  const done = isSpecCompleteForGeneration(nextSpec as SpecDraft);
  const nq = done ? null : buildNextQuestion(nextSpec as SpecDraft);
  const nextKey = done ? "ready" : nq?.key ?? null;

  const assistantText = [dialogue.assistantMessage, done ? "Spec looks complete. You can generate the activity." : nq?.prompt]
    .filter(Boolean)
    .join("\n\n");

  persistMessage("assistant", assistantText);
  persistCollectorState(sessionId, { currentQuestionKey: nextKey, buffer: [] });

  if (!done) {
    const target: SessionState = "CLARIFYING";
    transitionOrThrow(state, target);
    sessionDb.updateState(sessionId, target);
    return {
      accepted: true,
      state: target,
      nextQuestion: assistantText,
      questionKey: nextKey,
      done: false,
      spec: nextSpec,
      patch: [...fixed, ...appliedUserOps],
      next_action: "ask",
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
    nextQuestion: assistantText,
    questionKey: nextKey,
    done: true,
    spec: nextSpec,
    patch: [...fixed, ...appliedUserOps],
    next_action: "ready",
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
    const learning_mode = parseLearningMode((s as any).learning_mode);

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

    let progressHeartbeat: NodeJS.Timeout | null = null;

    try {
    // Transition to GENERATING (lock)
    transitionOrThrow(state, "GENERATING");
    sessionDb.updateState(sessionId, "GENERATING");
    progressHeartbeat = setInterval(() => {
      publishGenerationProgress(sessionId, { type: "heartbeat", ts: new Date().toISOString() });
    }, 1000);

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
    let outcomes: GenerationOutcome[] | null = null;
    let usedFallback = false;
    let appliedFallbackReason: string | null = null;

    for (let attempt = 0; attempt < 2 && !problems; attempt++) {
      // Derive ProblemPlan (always from current spec)
      const pedagogyPolicy =
        learning_mode === "guided"
          ? buildGuidedPedagogyPolicy({ spec, learnerProfile: getLearnerProfile({ userId, language: spec.language }) })
          : undefined;
      const plan = deriveProblemPlan(spec, pedagogyPolicy);
      sessionDb.setPlanJson(sessionId, JSON.stringify(plan));
      publishGenerationProgress(sessionId, {
        type: "generation_started",
        totalSlots: plan.length,
        totalProblems: plan.length,
        run: attempt + 1,
      });

      try {
        // Generate problems (per-slot with retries + Docker validation + discard reference_solution)
        const generated = await generateProblemsFromPlan(plan, {
          onProgress: (event: GenerationProgressEvent) => publishGenerationProgress(sessionId, event),
        });
        problems = generated.problems;
        outcomes = generated.outcomes;
      } catch (err: any) {
        if (err instanceof GenerationSlotFailureError) {
          if (Array.isArray(err.outcomesSoFar)) {
            sessionDb.updateGenerationOutcomesJson(sessionId, JSON.stringify(err.outcomesSoFar));
          }

          persistTraceEvent({
            ts: new Date().toISOString(),
            type: "generation_failure",
            slotIndex: err.slotIndex,
            kind: err.kind,
            attempts: err.attempts,
            title: err.title ?? null,
            llmOutputHash: err.llmOutputHash ?? null,
            message: err.message,
            outcomes: err.outcomesSoFar ?? null,
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
              appliedFallbackReason = decision.reason;

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

    if (outcomes) {
      const finalOutcomes = appliedFallbackReason
        ? outcomes.map((o) => ({ ...o, appliedFallback: o.appliedFallback ?? appliedFallbackReason }))
        : outcomes;
      sessionDb.updateGenerationOutcomesJson(sessionId, JSON.stringify(finalOutcomes));
      persistTraceEvent({
        ts: new Date().toISOString(),
        type: "generation_outcomes",
        outcomes: finalOutcomes,
      });
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
    publishGenerationProgress(sessionId, { type: "generation_completed", activityId });
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
        ...(err instanceof GenerationSlotFailureError ? { slotIndex: err.slotIndex } : {}),
      });
      throw err;
    } finally {
      if (progressHeartbeat) clearInterval(progressHeartbeat);
    }
  });
}
