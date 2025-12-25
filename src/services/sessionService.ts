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
import { generateNextPromptPayload } from "../agent/promptGenerator";
import { getDynamicQuestionKey } from "../agent/questionKey";
import { proposeGenerationFallback } from "../agent/generationFallback";
import { GenerationSlotFailureError } from "../generation/errors";
import { type DialogueUpdate, USER_EDITABLE_SPEC_KEYS, type UserEditableSpecKey } from "../agent/dialogue";
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
import { computeConfirmRequired } from "../agent/fieldCommitmentPolicy";
import { classifyDialogueAct } from "../agent/dialogueAct";
import { defaultPatchForGoal } from "../agent/deferDefaults";
import { getLearnerProfile } from "./learnerProfileService";
import { buildGuidedPedagogyPolicy } from "../planner/pedagogy";
import { logConversationMessage } from "../utils/devLogs";

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

function inferCommitmentSource(args: {
  field: UserEditableSpecKey;
  userMessage: string;
  currentQuestionKey: string | null;
  output?: IntentResolutionOutput | null;
}): "explicit" | "implicit" {
  const msg = args.userMessage.trim().toLowerCase();
  const qk = args.currentQuestionKey;
  const goal = qk?.startsWith("goal:") ? qk.slice("goal:".length) : null;

  if (args.output?.revision?.replaces?.includes(args.field)) return "explicit";
  if (qk === args.field) return "explicit";
  if (qk?.startsWith("invalid:") && qk.slice("invalid:".length) === args.field) return "explicit";
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
  const initialQuestionKey = getDynamicQuestionKey(initialSpec as SpecDraft, {}, null);
  sessionCollectorDb.upsert(id, initialQuestionKey, []);

  return { sessionId: id, state, learning_mode };
}

export function getSession(id: string): SessionRecord {
  const s = requireSession(id);
  const messages = sessionMessageDb.findBySessionId(id);
  const spec = parseSpecJson(s.spec_json);
  const confidence = parseJsonObject(s.confidence_json) as Record<string, number>;
  const commitments = parseCommitmentsJson(s.commitments_json);
  const collector = getCollectorState(id, getDynamicQuestionKey(spec as SpecDraft, confidence as any, commitments));
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
    const learning_mode = parseLearningMode((s as any).learning_mode);
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

  const expectedQuestionKey = getDynamicQuestionKey(specWithFixed as SpecDraft, existingConfidence, commitmentsStore);
  const collector = getCollectorState(sessionId, expectedQuestionKey);
  const updatedBuffer = [...collector.buffer, message];
  persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: updatedBuffer });

  const combined = updatedBuffer.join(" ").trim();
  traceText("session.message.combined", combined, { extra: { sessionId, bufferLen: updatedBuffer.length } });
  const existingTrace = parseJsonArray(s.intent_trace_json);
  let effectiveConfidence: ConfidenceMap = { ...existingConfidence };
  const dialogueAct = classifyDialogueAct(combined);

  // Deterministic "defer" handling: if user says "anything/whatever", apply safe defaults instead of looping.
  if (dialogueAct.act === "DEFER" && expectedQuestionKey?.startsWith("goal:")) {
    const goal = expectedQuestionKey.slice("goal:".length);
    const decision = defaultPatchForGoal(goal, specWithFixed as SpecDraft);
    if (decision) {
      const merged = applyJsonPatch(specWithFixed as any, decision.patch) as SpecDraft;
      const fixedAfter = ensureFixedFields(merged);
      const finalSpec = fixedAfter.length > 0 ? (applyJsonPatch(merged as any, fixedAfter) as SpecDraft) : merged;

      for (const op of decision.patch) {
        const key = op.path.startsWith("/") ? op.path.slice(1) : op.path;
        if (key) effectiveConfidence[key] = 1;
      }
      sessionDb.updateConfidenceJson(sessionId, JSON.stringify(effectiveConfidence));
      sessionDb.updateSpecJson(sessionId, JSON.stringify(finalSpec));

      const nextTrace = appendIntentTrace(existingTrace, {
        ts: new Date().toISOString(),
        type: "default_applied",
        goal,
        assumptions: decision.assumptions,
      });
      sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
      existingTrace.splice(0, existingTrace.length, ...nextTrace);

      const readiness = computeReadiness(finalSpec as SpecDraft, effectiveConfidence, commitmentsStore);
      const prompt = generateNextPromptPayload({
        spec: finalSpec as SpecDraft,
        readiness,
        confidence: effectiveConfidence,
        commitments: commitmentsStore,
        lastUserMessage: combined,
      });

      persistMessage("assistant", prompt.assistant_message);
      const nextKey = getDynamicQuestionKey(finalSpec as SpecDraft, effectiveConfidence, commitmentsStore);
      persistCollectorState(sessionId, { currentQuestionKey: nextKey, buffer: [] });

      const done = readiness.ready;
      const target: SessionState = done ? "READY" : "CLARIFYING";
      transitionOrThrow(state, target);
      sessionDb.updateState(sessionId, target);

      return {
        accepted: true,
        state: target,
        nextQuestion: prompt.assistant_message,
        questionKey: nextKey,
        done,
        spec: finalSpec,
        patch: [...fixed, ...decision.patch, ...fixedAfter],
        ...(prompt.assistant_summary ? { assistant_summary: prompt.assistant_summary } : {}),
        assumptions: decision.assumptions,
        next_action: prompt.next_action,
      };
    }
  }

  // Deterministic confirmation: if we're only asking to confirm low-confidence fields and the user replies "yes",
  // lock those fields and skip the LLM roundtrip.
  if (expectedQuestionKey?.startsWith("confirm:") && isPureConfirmationMessage(combined)) {
    const fields = expectedQuestionKey
      .slice("confirm:".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as UserEditableSpecKey[];

    for (const field of fields) {
      const value = (specWithFixed as any)[field];
      if (value === undefined) continue;
      effectiveConfidence[String(field)] = 1;
      commitmentsStore = upsertCommitment(commitmentsStore, {
        field,
        value,
        confidence: 1,
        source: "explicit",
      });
    }

    sessionDb.updateConfidenceJson(sessionId, JSON.stringify(effectiveConfidence));
    sessionDb.updateCommitmentsJson(sessionId, serializeCommitments(commitmentsStore));

    const nextTrace = appendIntentTrace(existingTrace, {
      ts: new Date().toISOString(),
      type: "commitment_confirmation",
      fields,
    });
    sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
    existingTrace.splice(0, existingTrace.length, ...nextTrace);

    const readiness = computeReadiness(specWithFixed as SpecDraft, effectiveConfidence, commitmentsStore);
    const prompt = generateNextPromptPayload({
      spec: specWithFixed as SpecDraft,
      readiness,
      confidence: effectiveConfidence,
      commitments: commitmentsStore,
      lastUserMessage: combined,
    });

    persistMessage("assistant", prompt.assistant_message);
    const nextKey = getDynamicQuestionKey(specWithFixed as SpecDraft, effectiveConfidence, commitmentsStore);
    persistCollectorState(sessionId, {
      currentQuestionKey: nextKey,
      buffer: [],
    });

    const done = readiness.ready;
    const target: SessionState = done ? "READY" : "CLARIFYING";
    if (!done) {
      transitionOrThrow(state, target);
      sessionDb.updateState(sessionId, target);
      return {
        accepted: true,
        state: target,
        nextQuestion: prompt.assistant_message,
        questionKey: nextKey,
        done: false,
        spec: specWithFixed,
        patch: fixed,
        ...(prompt.assistant_summary ? { assistant_summary: prompt.assistant_summary } : {}),
        ...(prompt.assumptions ? { assumptions: prompt.assumptions } : {}),
        next_action: prompt.next_action,
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
      nextQuestion: prompt.assistant_message,
      questionKey: nextKey,
      done: true,
      spec: specWithFixed,
      patch: fixed,
      ...(prompt.assistant_summary ? { assistant_summary: prompt.assistant_summary } : {}),
      ...(prompt.assumptions ? { assumptions: prompt.assumptions } : {}),
      next_action: prompt.next_action,
    };
  }

  const resolved = await resolveIntentWithLLM({
    userMessage: combined,
    currentSpec: specWithFixed as SpecDraft,
    currentQuestionKey: expectedQuestionKey,
    commitments: commitmentsStore,
    learningMode: learning_mode,
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
    persistMessage("assistant", assistantText);

    sessionDb.updateSpecJson(sessionId, JSON.stringify(specWithFixed));
    const nextKey = getDynamicQuestionKey(specWithFixed as SpecDraft, effectiveConfidence, commitmentsStore);
    persistCollectorState(sessionId, {
      currentQuestionKey: nextKey,
      buffer: [],
    });

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
    };
  }

  if (resolved.kind === "patch") {
    const confirm = computeConfirmRequired({
      userMessage: combined,
      currentSpec: specWithFixed as SpecDraft,
      inferredPatch: (resolved.output as any)?.inferredPatch ?? {},
    });
    if (confirm.required) {
      const nextTrace = appendIntentTrace(existingTrace, {
        ts: new Date().toISOString(),
        type: "confirm_required",
        ...confirm.event,
      });
      sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
      existingTrace.splice(0, existingTrace.length, ...nextTrace);

      const field = confirm.fields[0]!;
      const assistantText =
        field === "language"
          ? `I might be inferring a language switch. Which language should we use? Reply with one: java, python, cpp, sql.`
          : field === "problem_count"
          ? "How many problems should this activity have? (1–7)"
          : "What difficulty spread do you want? Example: easy:2, medium:2, hard:1";

      persistMessage("assistant", assistantText);
      sessionDb.updateSpecJson(sessionId, JSON.stringify(specWithFixed));
      const nextKey = `confirm:${confirm.fields.slice().sort().join(",")}`;
      persistCollectorState(sessionId, { currentQuestionKey: nextKey, buffer: [] });

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
      };
    }

    const nextSpec = resolved.merged as Record<string, unknown>;
    sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));

    // Update commitments for any accepted user-editable fields and clear commitments for invalidated removals.
    for (const op of resolved.patch) {
      if (!op.path.startsWith("/")) continue;
      const key = op.path.slice(1) as UserEditableSpecKey;
      if (!(USER_EDITABLE_SPEC_KEYS as readonly string[]).includes(key)) continue;

      if (op.op === "remove") {
        commitmentsStore = removeCommitment(commitmentsStore, key as any);
        continue;
      }

      const value = (resolved.merged as any)[key];
      const source = inferCommitmentSource({
        field: key,
        userMessage: combined,
        currentQuestionKey: expectedQuestionKey,
        output: resolved.output ?? null,
      });
      const confidenceForKey = effectiveConfidence[String(key)] ?? resolved.output?.confidence?.[String(key)] ?? 0;
      commitmentsStore = upsertCommitment(commitmentsStore, {
        field: key,
        value,
        confidence: confidenceForKey,
        source,
      });
    }
    sessionDb.updateCommitmentsJson(sessionId, serializeCommitments(commitmentsStore));

    const readiness = computeReadiness(resolved.merged, effectiveConfidence, commitmentsStore);
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

    const prompt = generateNextPromptPayload({
      spec: resolved.merged,
      readiness,
      confidence: effectiveConfidence,
      commitments: commitmentsStore,
      lastUserMessage: combined,
      dialogueUpdate,
    });

    persistMessage("assistant", prompt.assistant_message);
    const nextKey = getDynamicQuestionKey(resolved.merged, effectiveConfidence, commitmentsStore);
    persistCollectorState(sessionId, {
      currentQuestionKey: nextKey,
      buffer: [],
    });

    if (!done) {
      const target: SessionState = "CLARIFYING";
      transitionOrThrow(state, target);
      sessionDb.updateState(sessionId, target);
      return {
        accepted: true,
        state: target,
        nextQuestion: prompt.assistant_message,
        questionKey: nextKey,
        done: false,
        spec: nextSpec,
        patch: [...fixed, ...resolved.patch],
        ...(prompt.assistant_summary ? { assistant_summary: prompt.assistant_summary } : {}),
        ...(prompt.assumptions ? { assumptions: prompt.assumptions } : {}),
        next_action: prompt.next_action,
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
      nextQuestion: prompt.assistant_message,
      questionKey: nextKey,
      done: true,
      spec: nextSpec,
      patch: [...fixed, ...resolved.patch],
      ...(prompt.assistant_summary ? { assistant_summary: prompt.assistant_summary } : {}),
      ...(prompt.assumptions ? { assumptions: prompt.assumptions } : {}),
      next_action: prompt.next_action,
    };
  }

  // LLM returned noop/error: fall back to deterministic "what's missing next" prompt.
  trace("session.intent.fallback", { sessionId, kind: resolved.kind });
  const readiness = computeReadiness(specWithFixed as SpecDraft, effectiveConfidence, commitmentsStore);
  const prompt = generateNextPromptPayload({
    spec: specWithFixed as SpecDraft,
    readiness,
    confidence: effectiveConfidence,
    commitments: commitmentsStore,
    lastUserMessage: combined,
  });

  persistMessage("assistant", prompt.assistant_message);
  const nextKey = getDynamicQuestionKey(specWithFixed as SpecDraft, effectiveConfidence, commitmentsStore);
  persistCollectorState(sessionId, {
    currentQuestionKey: nextKey,
    buffer: [],
  });

  if (!readiness.ready) {
    const target: SessionState = "CLARIFYING";
    transitionOrThrow(state, target);
    sessionDb.updateState(sessionId, target);
    return {
      accepted: true,
      state: target,
      nextQuestion: prompt.assistant_message,
      questionKey: nextKey,
      done: false,
      spec: specWithFixed,
      patch: fixed,
      ...(prompt.assistant_summary ? { assistant_summary: prompt.assistant_summary } : {}),
      ...(prompt.assumptions ? { assumptions: prompt.assumptions } : {}),
      next_action: prompt.next_action,
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
      nextQuestion: prompt.assistant_message,
      questionKey: nextKey,
      done: true,
      spec: specWithFixed,
      patch: fixed,
      ...(prompt.assistant_summary ? { assistant_summary: prompt.assistant_summary } : {}),
      ...(prompt.assumptions ? { assumptions: prompt.assumptions } : {}),
      next_action: prompt.next_action,
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
