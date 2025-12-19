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
const jsonPatch_1 = require("../compiler/jsonPatch");
const activitySpec_1 = require("../contracts/activitySpec");
const profiles_1 = require("../languages/profiles");
const planner_1 = require("../planner");
const generation_1 = require("../generation");
const specDraft_1 = require("../compiler/specDraft");
const trace_1 = require("../utils/trace");
const traceContext_1 = require("../utils/traceContext");
const intentResolver_1 = require("../agent/intentResolver");
const readiness_1 = require("../agent/readiness");
const promptGenerator_1 = require("../agent/promptGenerator");
const questionKey_1 = require("../agent/questionKey");
const generationFallback_1 = require("../agent/generationFallback");
const errors_1 = require("../generation/errors");
const dialogue_1 = require("../agent/dialogue");
const progressBus_1 = require("../generation/progressBus");
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
function jsonStable(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function computeDialogueUpdate(args) {
    const changed = {};
    const added = [];
    const removed = [];
    for (const key of dialogue_1.USER_EDITABLE_SPEC_KEYS) {
        const before = args.previous[key];
        const after = args.next[key];
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
    const invalidated = removed.filter((k) => outputInvalidates.includes(k));
    const hasAny = Object.keys(changed).length > 0 || added.length > 0 || removed.length > 0 || invalidated.length > 0;
    if (!hasAny)
        return null;
    return { changed, added, removed, invalidated };
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
    const fixed = (0, specDraft_1.ensureFixedFields)({});
    const initialSpec = fixed.length > 0 ? (0, jsonPatch_1.applyJsonPatch)({}, fixed) : {};
    // Contract allows null or {} — DB column is NOT NULL, so we store {}.
    database_1.sessionDb.create(id, state, JSON.stringify(initialSpec), userId ?? null);
    const initialQuestionKey = (0, questionKey_1.getDynamicQuestionKey)(initialSpec, {});
    database_1.sessionCollectorDb.upsert(id, initialQuestionKey, []);
    return { sessionId: id, state };
}
function getSession(id) {
    const s = requireSession(id);
    const messages = database_1.sessionMessageDb.findBySessionId(id);
    const spec = parseSpecJson(s.spec_json);
    const confidence = parseJsonObject(s.confidence_json);
    const collector = getCollectorState(id, (0, questionKey_1.getDynamicQuestionKey)(spec, confidence));
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
    return (0, traceContext_1.withTraceContext)({ sessionId }, async () => {
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
        const existingConfidence = parseJsonObject(s.confidence_json);
        // Always persist user message.
        database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "user", message);
        const fixed = (0, specDraft_1.ensureFixedFields)(currentSpec);
        const specWithFixed = fixed.length > 0 ? (0, jsonPatch_1.applyJsonPatch)(currentSpec, fixed) : currentSpec;
        (0, trace_1.trace)("session.spec.fixed", { sessionId, fixedOps: fixed.map((op) => op.path) });
        const expectedQuestionKey = (0, questionKey_1.getDynamicQuestionKey)(specWithFixed, existingConfidence);
        const collector = getCollectorState(sessionId, expectedQuestionKey);
        const updatedBuffer = [...collector.buffer, message];
        persistCollectorState(sessionId, { currentQuestionKey: expectedQuestionKey, buffer: updatedBuffer });
        const combined = updatedBuffer.join(" ").trim();
        (0, trace_1.traceText)("session.message.combined", combined, { extra: { sessionId, bufferLen: updatedBuffer.length } });
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
            existingTrace.splice(0, existingTrace.length, ...nextTrace);
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
                currentQuestionKey: (0, questionKey_1.getDynamicQuestionKey)(specWithFixed, effectiveConfidence),
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
            const dialogueUpdate = computeDialogueUpdate({
                previous: specWithFixed,
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
                database_1.sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
                existingTrace.splice(0, existingTrace.length, ...nextTrace);
            }
            const nextQuestion = (0, promptGenerator_1.generateNextPrompt)({
                spec: resolved.merged,
                readiness,
                confidence: effectiveConfidence,
                lastUserMessage: combined,
                dialogueUpdate,
            });
            database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", nextQuestion);
            persistCollectorState(sessionId, {
                currentQuestionKey: (0, questionKey_1.getDynamicQuestionKey)(resolved.merged, effectiveConfidence),
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
        // LLM returned noop/error: fall back to deterministic "what's missing next" prompt.
        (0, trace_1.trace)("session.intent.fallback", { sessionId, kind: resolved.kind });
        const readiness = (0, readiness_1.computeReadiness)(specWithFixed, effectiveConfidence);
        const nextQuestion = (0, promptGenerator_1.generateNextPrompt)({
            spec: specWithFixed,
            readiness,
            confidence: effectiveConfidence,
            lastUserMessage: combined,
        });
        database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", nextQuestion);
        persistCollectorState(sessionId, {
            currentQuestionKey: (0, questionKey_1.getDynamicQuestionKey)(specWithFixed, effectiveConfidence),
            buffer: [],
        });
        if (!readiness.ready) {
            const target = "CLARIFYING";
            transitionOrThrow(state, target);
            database_1.sessionDb.updateState(sessionId, target);
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
            spec: specWithFixed,
            patch: fixed,
        };
    });
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
    return (0, traceContext_1.withTraceContext)({ sessionId }, async () => {
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
        const existingTrace = parseJsonArray(s.intent_trace_json);
        const existingConfidence = parseJsonObject(s.confidence_json);
        const persistTraceEvent = (entry) => {
            const nextTrace = appendIntentTrace(existingTrace, entry);
            database_1.sessionDb.updateIntentTraceJson(sessionId, JSON.stringify(nextTrace));
            // Mutate local reference so multiple events in this call don't clobber each other.
            existingTrace.splice(0, existingTrace.length, ...nextTrace);
        };
        const persistConfidencePatch = (patch) => {
            const incoming = {};
            for (const op of patch) {
                const key = op.path.startsWith("/") ? op.path.slice(1) : op.path;
                if (!key)
                    continue;
                // System-made adjustments are deterministic; mark as high confidence.
                incoming[key] = 1;
            }
            const next = mergeConfidence(existingConfidence, incoming);
            database_1.sessionDb.updateConfidenceJson(sessionId, JSON.stringify(next));
            Object.assign(existingConfidence, next);
        };
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
            let spec = specResult.data;
            if (!(0, profiles_1.isLanguageSupportedForGeneration)(spec.language)) {
                throw new Error(`Language "${spec.language}" is not supported for generation yet.`);
            }
            let problems = null;
            let usedFallback = false;
            for (let attempt = 0; attempt < 2 && !problems; attempt++) {
                // Derive ProblemPlan (always from current spec)
                const plan = (0, planner_1.deriveProblemPlan)(spec);
                database_1.sessionDb.setPlanJson(sessionId, JSON.stringify(plan));
                (0, progressBus_1.publishGenerationProgress)(sessionId, {
                    type: "generation_started",
                    totalProblems: plan.length,
                    run: attempt + 1,
                });
                try {
                    // Generate problems (per-slot with retries + Docker validation + discard reference_solution)
                    problems = await (0, generation_1.generateProblemsFromPlan)(plan, {
                        onProgress: (event) => (0, progressBus_1.publishGenerationProgress)(sessionId, event),
                    });
                }
                catch (err) {
                    if (err instanceof errors_1.GenerationSlotFailureError) {
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
                        (0, trace_1.trace)("generation.failure.persisted", {
                            sessionId,
                            slotIndex: err.slotIndex,
                            kind: err.kind,
                            llmOutputHash: err.llmOutputHash,
                        });
                        if (!usedFallback) {
                            const decision = (0, generationFallback_1.proposeGenerationFallback)(spec);
                            if (decision) {
                                usedFallback = true;
                                persistTraceEvent({
                                    ts: new Date().toISOString(),
                                    type: "generation_soft_fallback",
                                    reason: decision.reason,
                                    patch: decision.patch,
                                });
                                persistConfidencePatch(decision.patch);
                                const adjusted = (0, jsonPatch_1.applyJsonPatch)(spec, decision.patch);
                                const adjustedRes = activitySpec_1.ActivitySpecSchema.safeParse(adjusted);
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
                                database_1.sessionDb.updateSpecJson(sessionId, JSON.stringify(spec));
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
            (0, progressBus_1.publishGenerationProgress)(sessionId, { type: "generation_complete", activityId });
            if (usedFallback) {
                persistTraceEvent({
                    ts: new Date().toISOString(),
                    type: "generation_soft_fallback_succeeded",
                });
            }
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
            (0, progressBus_1.publishGenerationProgress)(sessionId, {
                type: "generation_failed",
                error: "Generation failed. Please try again.",
            });
            throw err;
        }
    });
}
//# sourceMappingURL=sessionService.js.map