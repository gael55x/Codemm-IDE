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
const patch_1 = require("../specBuilder/patch");
const activitySpec_1 = require("../contracts/activitySpec");
const planner_1 = require("../planner");
const generation_1 = require("../generation");
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
    return { sessionId: id, state };
}
function getSession(id) {
    const s = requireSession(id);
    const messages = database_1.sessionMessageDb.findBySessionId(id);
    return {
        id: s.id,
        state: s.state,
        spec: parseSpecJson(s.spec_json),
        messages,
    };
}
function processSessionMessage(sessionId, message) {
    const s = requireSession(sessionId);
    const state = s.state;
    if (state !== "DRAFT" && state !== "CLARIFYING") {
        const err = new Error(`Cannot post messages when session state is ${state}.`);
        err.status = 409;
        throw err;
    }
    const currentSpec = parseSpecJson(s.spec_json);
    const result = (0, specBuilder_1.specBuilderStep)(currentSpec, message);
    // Always persist user message.
    database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "user", message);
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
            spec: currentSpec,
        };
    }
    const patch = result.patch ?? [];
    const nextSpec = (0, patch_1.applyJsonPatch)(currentSpec, patch);
    database_1.sessionDb.updateSpecJson(sessionId, JSON.stringify(nextSpec));
    const nextQuestion = result.nextQuestion;
    database_1.sessionMessageDb.create(crypto_1.default.randomUUID(), sessionId, "assistant", nextQuestion);
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