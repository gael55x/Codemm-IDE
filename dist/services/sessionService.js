"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSession = createSession;
exports.getSession = getSession;
exports.processSessionMessage = processSessionMessage;
exports.generateFromSession = generateFromSession;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../database");
const session_1 = require("../contracts/session");
const specBuilder_1 = require("../specBuilder");
const intent_1 = require("../specBuilder/intent");
const patch_1 = require("../specBuilder/patch");
const activitySpec_1 = require("../contracts/activitySpec");
const planner_1 = require("../planner");
const generation_1 = require("../generation");
const validators_1 = require("../specBuilder/validators");
const intentInterpreter_1 = require("../intentInterpreter");
const trace_1 = require("../utils/trace");
const intentResolver_1 = require("../agent/intentResolver");
const readiness_1 = require("../agent/readiness");
const promptGenerator_1 = require("../agent/promptGenerator");
function parseJsonObject(json) {
    if (!json)
        return {};
    try {
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            return parsed;
    }
    catch {
        // ignore
    }
    return {};
}
function parseJsonArray(json) {
    if (!json)
        return [];
    try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed))
            return parsed;
    }
    catch {
        // ignore
    }
    return [];
}
function mergeConfidence(existing, incoming) {
    const next = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
        if (typeof v !== "number" || !Number.isFinite(v))
            continue;
        next[k] = Math.max(0, Math.min(1, v));
    }
    return next;
}
function appendIntentTrace(existing, entry, maxEntries = 200) {
    const next = [...existing, entry];
    return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
}
function requireSession(id) {
    const session = database_1.sessionDb.findById(id);
    if (!session) {
        const err = new Error("Session not found");
        err.status = 404;
        throw err;
    }
    return session;
}
function parseSpecJson(specJson) {
    if (!specJson || !specJson.trim())
        return {};
    try {
        const parsed = JSON.parse(specJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        return {};
    }
    catch {
        return {};
    }
}
function parseCollectorBuffer(bufferJson) {
    if (!bufferJson)
        return [];
    try {
        const parsed = JSON.parse(bufferJson);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => typeof item === "string");
        }
    }
    catch {
        // ignore parse errors and reset to empty buffer
    }
    return [];
}
function persistCollectorState(sessionId, state) {
    database_1.sessionCollectorDb.upsert(sessionId, state.currentQuestionKey, state.buffer);
    return state;
}
function getCollectorState(sessionId, expectedQuestionKey) {
    const existing = database_1.sessionCollectorDb.findBySessionId(sessionId);
    if (!existing) {
        return persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: [] });
    }
    const buffer = parseCollectorBuffer(existing.buffer_json);
    const storedKey = existing.current_question_key ?? null;
    if (storedKey !== expectedQuestionKey) {
        return persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: [] });
    }
    return { currentQuestionKey: storedKey, buffer };
}
function transitionOrThrow(from, to) {
    if (from === to)
        return;
    if (!(0, session_1.canTransition)(from, to)) {
        const err = new Error(`Invalid session state transition: ${from} -> ${to}`);
        err.status = 409;
        throw err;
    }
}
function createSession(userId) {
    const id = crypto_1.default.randomUUID();
    const state = "DRAFT";
    // Contract allows null or {} — DB column is NOT NULL, so we store {}.
    database_1.sessionDb.create(id, state, "{}", userId ?? null);
    const initialQuestionKey = (0, intent_1.nextSlotKey)({});
    database_1.sessionCollectorDb.upsert(id, initialQuestionKey, []);
    return { sessionId: id, state };
}
function getSession(id) {
    const s = requireSession(id);
    const messages = database_1.sessionMessageDb.findBySessionId(id);
    const spec = parseSpecJson(s.spec_json);
    const collector = getCollectorState(id, (0, intent_1.nextSlotKey)(spec));
    const confidence = parseJsonObject(s.confidence_json);
    const intentTrace = parseJsonArray(s.intent_trace_json).slice(-50);
    return {
        id: s.id,
        state: s.state,
        spec,
        messages,
        collector,
        confidence,
        intentTrace,
    };
}
async function processSessionMessage(sessionId, message) {
    const s = requireSession(sessionId);
    const state = s.state;
    (0, trace_1.trace)("session.message.start", { sessionId, state });
    (0, trace_1.traceText)("session.message.user", message, { extra: { sessionId } });
    if (state !== "DRAFT" && state !== "CLARIFYING") {
        const err = new Error(`Cannot post messages when session state is ${state}.`);
        err.status = 409;
        throw err;
    }
    const currentSpec = parseSpecJson(s.spec_json);
    const currentQuestionKey = (0, intent_1.nextSlotKey)(currentSpec);
    // Always persist user message.
    database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "user", message);
    const collector = getCollectorState(sessionId, currentQuestionKey);
    const updatedBuffer = [...collector.buffer, message];
    persistCollectorState(sessionId, { currentQuestionKey, buffer: updatedBuffer });
    const combined = updatedBuffer.join(" ").trim();
    (0, trace_1.traceText)("session.message.combined", combined, { extra: { sessionId, bufferLen: updatedBuffer.length } });
    const fixed = (0, validators_1.ensureFixedFields)(currentSpec);
    const specWithFixed = fixed.length > 0 ? (0, patch_1.applyJsonPatch)(currentSpec, fixed) : currentSpec;
    (0, trace_1.trace)("session.spec.fixed", { sessionId, fixedOps: fixed.map((op) => op.path) });
    // Optional dynamic intent resolver (LLM) — can be enabled without removing the compiler fallback.
    // This is the first step toward a goal-driven agent loop:
    // - LLM proposes a safe partial patch + confidence
    // - We still enforce strict draft validation before applying
    // - If it can't infer, we fall back to deterministic systems
    if (process.env.CODEMM_AGENT_MODE === "dynamic") {
        const existingConfidence = parseJsonObject(s.confidence_json);
        const existingTrace = parseJsonArray(s.intent_trace_json);
        let effectiveConfidence = { ...existingConfidence };
        const resolved = await (0, intentResolver_1.resolveIntentWithLLM)({
            userMessage: combined,
            currentSpec: specWithFixed,
        }).catch((e) => ({ kind: "error", error: e?.message ?? String(e) }));
        if ("output" in resolved && resolved.output) {
            const output = resolved.output;
            const nextConfidence = mergeConfidence(existingConfidence, output.confidence ?? {});
            effectiveConfidence = nextConfidence;
            const nextTrace = appendIntentTrace(existingTrace, {
                ts: new Date().toISOString(),
                userMessage: combined,
                output,
                result: resolved.kind,
            });
            database_1.sessionDb.updateConfidenceJson(sessionId, JSON.stringify(nextConfidence));
            database_1.sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
            (0, trace_1.trace)("session.intent.persisted", {
                sessionId,
                confidenceKeys: Object.keys(nextConfidence),
                traceLen: nextTrace.length,
            });
        }
        if (resolved.kind === "clarify") {
            const assistantText = resolved.question;
            database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", assistantText);
            database_1.sessionDb.updateSpecJson(sessionId, JSON.stringify(specWithFixed));
            persistCollectorState(sessionId, {
                currentQuestionKey: (0, intent_1.nextSlotKey)(specWithFixed),
                buffer: [],
            });
            const target = "CLARIFYING";
            transitionOrThrow(state, target);
            database_1.sessionDb.updateState(sessionId, target);
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
            const nextSpec = resolved.merged;
            database_1.sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));
            const readiness = (0, readiness_1.computeReadiness)(resolved.merged, effectiveConfidence);
            (0, trace_1.trace)("session.readiness", {
                sessionId,
                schemaComplete: readiness.gaps.complete,
                ready: readiness.ready,
                minConfidence: readiness.minConfidence,
                lowConfidenceFields: readiness.lowConfidenceFields,
                missing: readiness.gaps.missing,
            });
            const done = readiness.ready;
            const nextQuestion = (0, promptGenerator_1.generateNextPrompt)({
                spec: resolved.merged,
                readiness,
                confidence: effectiveConfidence,
                lastUserMessage: combined,
            });
            database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", nextQuestion);
            persistCollectorState(sessionId, {
                currentQuestionKey: (0, intent_1.nextSlotKey)(resolved.merged),
                buffer: [],
            });
            if (!done) {
                const target = "CLARIFYING";
                transitionOrThrow(state, target);
                database_1.sessionDb.updateState(sessionId, target);
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
                database_1.sessionDb.updateState(sessionId, "CLARIFYING");
                transitionOrThrow("CLARIFYING", "READY");
                database_1.sessionDb.updateState(sessionId, "READY");
            }
            else {
                transitionOrThrow(state, "READY");
                database_1.sessionDb.updateState(sessionId, "READY");
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
    }
    const interpreted = (0, intentInterpreter_1.interpretIntent)(specWithFixed, combined);
    (0, trace_1.trace)("session.intent", { sessionId, kind: interpreted.kind });
    if (interpreted.kind === "conflict") {
        // Persist assistant clarification.
        const content = interpreted.message;
        database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", content);
        // Persist fixed invariants (safe side-effect, improves UX on repeated clarifications).
        if (fixed.length > 0) {
            database_1.sessionDb.updateSpecJson(sessionId, JSON.stringify(specWithFixed));
        }
        // Reset buffer; treat this as a new question turn.
        persistCollectorState(sessionId, {
            currentQuestionKey: (0, intent_1.nextSlotKey)(specWithFixed),
            buffer: [],
        });
        // Transition into CLARIFYING (agent asked a follow-up).
        const target = "CLARIFYING";
        transitionOrThrow(state, target);
        database_1.sessionDb.updateState(sessionId, target);
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
        (0, trace_1.trace)("session.intent.patch", { sessionId, ops: interpreted.patch.map((op) => op.path) });
        const nextSpecCandidate = (0, patch_1.applyJsonPatch)(specWithFixed, interpreted.patch);
        const contractError = (0, validators_1.validatePatchedSpecOrError)(nextSpecCandidate);
        if (contractError) {
            (0, trace_1.trace)("session.intent.contract_error", { sessionId, error: contractError });
            const nextQuestion = (0, specBuilder_1.getNextQuestion)(specWithFixed);
            database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", `${contractError}\n\n${nextQuestion}`);
            return {
                accepted: false,
                state,
                nextQuestion,
                done: false,
                error: contractError,
                spec: specWithFixed,
            };
        }
        const nextSpec = nextSpecCandidate;
        const done = (0, validators_1.isSpecComplete)(nextSpecCandidate);
        const nextQuestion = done
            ? "Spec looks complete. You can generate the activity."
            : (0, specBuilder_1.getNextQuestion)(nextSpecCandidate);
        (0, trace_1.trace)("session.intent.applied", { sessionId, done });
        const summaryPrefix = interpreted.summaryLines.length >= 2
            ? `Got it: ${interpreted.summaryLines.join("; ")}\n\n`
            : "";
        const assistantText = `${summaryPrefix}${nextQuestion}`;
        database_1.sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));
        database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", assistantText);
        persistCollectorState(sessionId, {
            currentQuestionKey: (0, intent_1.nextSlotKey)(nextSpecCandidate),
            buffer: [],
        });
        const patch = [...fixed, ...interpreted.patch];
        if (!done) {
            const target = "CLARIFYING";
            transitionOrThrow(state, target);
            database_1.sessionDb.updateState(sessionId, target);
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
            database_1.sessionDb.updateState(sessionId, "CLARIFYING");
            transitionOrThrow("CLARIFYING", "READY");
            database_1.sessionDb.updateState(sessionId, "READY");
        }
        else {
            transitionOrThrow(state, "READY");
            database_1.sessionDb.updateState(sessionId, "READY");
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
    const result = (0, specBuilder_1.specBuilderStep)(currentSpec, combined);
    if (!result.accepted) {
        const error = result.error ?? "Invalid answer.";
        const nextQuestion = result.nextQuestion;
        // Persist assistant message re-asking the same question (with error context).
        database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", `${error}\n\n${nextQuestion}`);
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
    const nextSpec = (0, patch_1.applyJsonPatch)(currentSpec, patch);
    database_1.sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));
    const nextQuestion = result.nextQuestion;
    database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", nextQuestion);
    persistCollectorState(sessionId, { currentQuestionKey: (0, intent_1.nextSlotKey)(nextSpec), buffer: [] });
    // Update session state (strict transitions)
    if (!result.done) {
        // DRAFT -> CLARIFYING, CLARIFYING -> CLARIFYING
        const target = "CLARIFYING";
        transitionOrThrow(state, target);
        database_1.sessionDb.updateState(sessionId, target);
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
        database_1.sessionDb.updateState(sessionId, "CLARIFYING");
        transitionOrThrow("CLARIFYING", "READY");
        database_1.sessionDb.updateState(sessionId, "READY");
    }
    else {
        transitionOrThrow(state, "READY");
        database_1.sessionDb.updateState(sessionId, "READY");
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
async function generateFromSession(sessionId, userId) {
    const s = requireSession(sessionId);
    const state = s.state;
    if (state !== "READY") {
        const err = new Error(`Cannot generate when session state is ${state}. Expected READY.`);
        err.status = 409;
        throw err;
    }
    // Guard: reject if problems already generated (prevent accidental re-generation)
    if (s.problems_json && s.problems_json.trim()) {
        const err = new Error("Session already has generated problems. Cannot re-generate.");
        err.status = 409;
        throw err;
    }
    try {
        // Transition to GENERATING (lock)
        transitionOrThrow(state, "GENERATING");
        database_1.sessionDb.updateState(sessionId, "GENERATING");
        // Parse and validate ActivitySpec
        const specObj = parseSpecJson(s.spec_json);
        const specResult = activitySpec_1.ActivitySpecSchema.safeParse(specObj);
        if (!specResult.success) {
            throw new Error(`Invalid ActivitySpec: ${specResult.error.issues[0]?.message ?? "validation failed"}`);
        }
        const spec = specResult.data;
        // Derive ProblemPlan
        const plan = (0, planner_1.deriveProblemPlan)(spec);
        database_1.sessionDb.setPlanJson(sessionId, JSON.stringify(plan));
        // Generate problems (per-slot with retries + Docker validation + discard reference_solution)
        const problems = await (0, generation_1.generateProblemsFromPlan)(plan);
        // Persist problems_json
        database_1.sessionDb.setProblemsJson(sessionId, JSON.stringify(problems));
        // Create Activity record
        const activityId = crypto_1.default.randomUUID();
        const activityTitle = `Activity (${spec.problem_count} problems)`;
        database_1.activityDb.create(activityId, userId, activityTitle, JSON.stringify(problems), undefined);
        // Link activity to session
        database_1.sessionDb.setActivityId(sessionId, activityId);
        // Transition to SAVED
        transitionOrThrow("GENERATING", "SAVED");
        database_1.sessionDb.updateState(sessionId, "SAVED");
        return { activityId, problems };
    }
    catch (err) {
        // Transition to FAILED
        try {
            transitionOrThrow("GENERATING", "FAILED");
            database_1.sessionDb.updateState(sessionId, "FAILED");
            database_1.sessionDb.setLastError(sessionId, err.message ?? "Unknown error during generation.");
        }
        catch (transitionErr) {
            console.error("Failed to transition session to FAILED:", transitionErr);
        }
        throw err;
    }
}
//# sourceMappingURL=sessionService.js.map