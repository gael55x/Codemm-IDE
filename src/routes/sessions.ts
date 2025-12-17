import { Router } from "express";
import {
  createSession,
  getSession,
  processSessionMessage,
  generateFromSession,
} from "../services/sessionService";
import { authenticateToken, type AuthRequest } from "../auth";

export const sessionsRouter = Router();

sessionsRouter.post("/", (req, res) => {
  try {
    const { sessionId, state } = createSession(null);
    res.status(201).json({ sessionId, state });
  } catch (err: any) {
    console.error("Error in POST /sessions:", err);
    res.status(500).json({ error: "Failed to create session." });
  }
});

sessionsRouter.post("/:id/messages", async (req, res) => {
  try {
    const id = req.params.id as string;
    const { message } = req.body ?? {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required string." });
    }

    const result = await processSessionMessage(id, message.trim());

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
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status >= 500) {
      console.error("Error in POST /sessions/:id/messages:", err);
    }

    res.status(status).json({
      error:
        status === 404
          ? "Session not found."
          : status === 409
          ? err.message
          : "Failed to process message.",
    });
  }
});

sessionsRouter.get("/:id", (req, res) => {
  try {
    const id = req.params.id as string;
  const s = getSession(id);

  res.json({
    sessionId: s.id,
    state: s.state,
    spec: s.spec,
    messages: s.messages,
    collector: s.collector,
    confidence: s.confidence,
    intentTrace: s.intentTrace,
  });
} catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status >= 500) {
      console.error("Error in GET /sessions/:id:", err);
    }
    res.status(status).json({
      error: status === 404 ? "Session not found." : "Failed to fetch session.",
    });
  }
});

sessionsRouter.post("/:id/generate", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const { activityId, problems } = await generateFromSession(id, userId);

    res.status(200).json({
      activityId,
      problemCount: problems.length,
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status >= 500) {
      console.error("Error in POST /sessions/:id/generate:", err);
    }

    res.status(status).json({
      error:
        status === 404
          ? "Session not found."
          : status === 409
          ? err.message
          : "Failed to generate activity.",
      detail: status >= 500 ? err.message : undefined,
    });
  }
});
