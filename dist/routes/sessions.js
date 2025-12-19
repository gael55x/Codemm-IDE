"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionsRouter = void 0;
const express_1 = require("express");
const sessionService_1 = require("../services/sessionService");
const auth_1 = require("../auth");
const trace_1 = require("../utils/trace");
const traceBus_1 = require("../utils/traceBus");
const progressBus_1 = require("../generation/progressBus");
exports.sessionsRouter = (0, express_1.Router)();
function sanitizeTracePayload(payload) {
    const drop = new Set([
        // Never stream prompts/raw generations/reference code to UI.
        "text",
        "rawSnippet",
        "previousRaw",
        "previousDraft",
        "judgeStdout",
        "judgeStderr",
    ]);
    const safe = {};
    for (const [k, v] of Object.entries(payload)) {
        if (drop.has(k))
            continue;
        if (typeof v === "string" && v.length > 2000) {
            safe[k] = `${v.slice(0, 2000)}…(truncated)`;
            continue;
        }
        safe[k] = v;
    }
    return safe;
}
exports.sessionsRouter.post("/", (req, res) => {
    try {
        const { sessionId, state } = (0, sessionService_1.createSession)(null);
        res.status(201).json({ sessionId, state });
    }
    catch (err) {
        console.error("Error in POST /sessions:", err);
        res.status(500).json({ error: "Failed to create session." });
    }
});
// Server-sent events stream for UX-friendly progress tracing (no chain-of-thought).
exports.sessionsRouter.get("/:id/trace", (req, res) => {
    const id = req.params.id;
    if (!(0, trace_1.isTraceEnabled)()) {
        return res.status(404).json({ error: "Trace stream disabled. Set CODEMM_TRACE=1 on backend." });
    }
    try {
        // Ensure session exists.
        (0, sessionService_1.getSession)(id);
    }
    catch (err) {
        const status = typeof err?.status === "number" ? err.status : 500;
        return res.status(status).json({ error: status === 404 ? "Session not found." : "Failed to open trace." });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Initial event
    res.write(`event: ready\n`);
    res.write(`data: ${JSON.stringify({ ts: new Date().toISOString(), event: "trace.ready", sessionId: id })}\n\n`);
    const unsubscribe = (0, traceBus_1.subscribeTrace)(id, (payload) => {
        res.write(`data: ${JSON.stringify(sanitizeTracePayload(payload))}\n\n`);
    });
    const heartbeat = setInterval(() => {
        res.write(`: ping ${Date.now()}\n\n`);
    }, 15000);
    req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});
// Server-sent events stream for structured generation progress (no prompts, no reasoning).
exports.sessionsRouter.get("/:id/generate/stream", (req, res) => {
    const id = req.params.id;
    try {
        // Ensure session exists.
        (0, sessionService_1.getSession)(id);
    }
    catch (err) {
        const status = typeof err?.status === "number" ? err.status : 500;
        return res.status(status).json({ error: status === 404 ? "Session not found." : "Failed to open progress stream." });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Initial event
    res.write(`event: ready\n`);
    res.write(`data: ${JSON.stringify({ ts: new Date().toISOString(), event: "progress.ready", sessionId: id })}\n\n`);
    // Replay buffered events (covers the "stream opened late" case).
    const buffered = (0, progressBus_1.getGenerationProgressBuffer)(id);
    for (const ev of buffered) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    const unsubscribe = (0, progressBus_1.subscribeGenerationProgress)(id, (ev) => {
        try {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
            if (ev.type === "generation_complete" || ev.type === "generation_failed") {
                // Allow a final flush before closing.
                setTimeout(() => {
                    try {
                        res.end();
                    }
                    catch {
                        // ignore
                    }
                }, 50);
            }
        }
        catch {
            // ignore write errors (client disconnected)
        }
    });
    const heartbeat = setInterval(() => {
        res.write(`: ping ${Date.now()}\n\n`);
    }, 15000);
    req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});
exports.sessionsRouter.post("/:id/messages", async (req, res) => {
    try {
        const id = req.params.id;
        const { message } = req.body ?? {};
        if (typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ error: "message is required string." });
        }
        const result = await (0, sessionService_1.processSessionMessage)(id, message.trim());
        if (!result.accepted) {
            return res.status(200).json({
                accepted: false,
                state: result.state,
                nextQuestion: result.nextQuestion,
                done: false,
                error: result.error,
                spec: result.spec,
            });
        }
        return res.status(200).json({
            accepted: true,
            state: result.state,
            nextQuestion: result.nextQuestion,
            spec: result.spec,
            done: result.done,
        });
    }
    catch (err) {
        const status = typeof err?.status === "number" ? err.status : 500;
        if (status >= 500) {
            console.error("Error in POST /sessions/:id/messages:", err);
        }
        res.status(status).json({
            error: status === 404
                ? "Session not found."
                : status === 409
                    ? err.message
                    : "Failed to process message.",
        });
    }
});
exports.sessionsRouter.get("/:id", (req, res) => {
    try {
        const id = req.params.id;
        const s = (0, sessionService_1.getSession)(id);
        res.json({
            sessionId: s.id,
            state: s.state,
            spec: s.spec,
            messages: s.messages,
            collector: s.collector,
            confidence: s.confidence,
            intentTrace: s.intentTrace,
        });
    }
    catch (err) {
        const status = typeof err?.status === "number" ? err.status : 500;
        if (status >= 500) {
            console.error("Error in GET /sessions/:id:", err);
        }
        res.status(status).json({
            error: status === 404 ? "Session not found." : "Failed to fetch session.",
        });
    }
});
exports.sessionsRouter.post("/:id/generate", auth_1.authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user.id;
        const { activityId, problems } = await (0, sessionService_1.generateFromSession)(id, userId);
        res.status(200).json({
            activityId,
            problemCount: problems.length,
        });
    }
    catch (err) {
        const status = typeof err?.status === "number" ? err.status : 500;
        if (status >= 500) {
            console.error("Error in POST /sessions/:id/generate:", err);
        }
        res.status(status).json({
            error: status === 404
                ? "Session not found."
                : status === 409
                    ? err.message
                    : "Failed to generate activity.",
            detail: status >= 500 ? err.message : undefined,
        });
    }
});
//# sourceMappingURL=sessions.js.map