"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionsRouter = void 0;
const express_1 = require("express");
const sessionService_1 = require("../services/sessionService");
const auth_1 = require("../auth");
exports.sessionsRouter = (0, express_1.Router)();
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