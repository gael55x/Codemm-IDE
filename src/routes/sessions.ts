import { Router } from "express";
import {
  createSession,
  getSession,
  processSessionMessage,
  generateFromSession,
} from "../services/sessionService";
import { authenticateToken, type AuthRequest } from "../auth";
import { isTraceEnabled } from "../utils/trace";
import { subscribeTrace } from "../utils/traceBus";
import { getGenerationProgressBuffer, subscribeGenerationProgress } from "../generation/progressBus";
import type { GenerationProgressEvent } from "../contracts/generationProgress";
import { LearningModeSchema } from "../contracts/learningMode";
import { computeReadiness } from "../agent/readiness";
import { generateNextPromptPayload } from "../agent/promptGenerator";

export const sessionsRouter = Router();

function sanitizeTracePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const drop = new Set([
    // Never stream prompts/raw generations/reference code to UI.
    "text",
    "rawSnippet",
    "previousRaw",
    "previousDraft",
    "judgeStdout",
    "judgeStderr",
  ]);

  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (drop.has(k)) continue;
    if (typeof v === "string" && v.length > 2000) {
      safe[k] = `${v.slice(0, 2000)}…(truncated)`;
      continue;
    }
    safe[k] = v;
  }
  return safe;
}

sessionsRouter.post("/", (req, res) => {
  try {
    const parsed = LearningModeSchema.optional().safeParse(req.body?.learning_mode);
    const learningMode = parsed.success ? parsed.data : undefined;
    const { sessionId, state, learning_mode } = createSession(null, learningMode);
    const session = getSession(sessionId);
    const readiness = computeReadiness(session.spec as any, session.confidence as any, null);
    const prompt = generateNextPromptPayload({
      spec: session.spec as any,
      readiness,
      confidence: session.confidence as any,
      commitments: null,
      lastUserMessage: "",
    });

    res.status(201).json({
      sessionId,
      state,
      learning_mode,
      nextQuestion: prompt.assistant_message,
      questionKey: session.collector.currentQuestionKey,
      done: false,
      ...(prompt.assistant_summary ? { assistant_summary: prompt.assistant_summary } : {}),
      ...(prompt.assumptions ? { assumptions: prompt.assumptions } : {}),
      next_action: prompt.next_action,
    });
  } catch (err: any) {
    console.error("Error in POST /sessions:", err);
    res.status(500).json({ error: "Failed to create session." });
  }
});

// Server-sent events stream for UX-friendly progress tracing (no chain-of-thought).
sessionsRouter.get("/:id/trace", (req, res) => {
  const id = req.params.id as string;

  if (!isTraceEnabled()) {
    return res.status(404).json({ error: "Trace stream disabled. Set CODEMM_TRACE=1 on backend." });
  }

  try {
    // Ensure session exists.
    getSession(id);
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    return res.status(status).json({ error: status === 404 ? "Session not found." : "Failed to open trace." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  // Initial event
  res.write(`event: ready\n`);
  res.write(`data: ${JSON.stringify({ ts: new Date().toISOString(), event: "trace.ready", sessionId: id })}\n\n`);

  const unsubscribe = subscribeTrace(id, (payload) => {
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
sessionsRouter.get("/:id/generate/stream", (req, res) => {
  const id = req.params.id as string;

  try {
    // Ensure session exists.
    getSession(id);
  } catch (err: any) {
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
  const buffered = getGenerationProgressBuffer(id);
  for (const ev of buffered) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  const unsubscribe = subscribeGenerationProgress(id, (ev: GenerationProgressEvent) => {
    try {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (
        ev.type === "generation_complete" ||
        ev.type === "generation_completed" ||
        ev.type === "generation_failed"
      ) {
        // Allow a final flush before closing.
        setTimeout(() => {
          try {
            res.end();
          } catch {
            // ignore
          }
        }, 50);
      }
    } catch {
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
	        questionKey: result.questionKey,
	        done: false,
	        error: result.error,
	        spec: result.spec,
	        assistant_summary: (result as any).assistant_summary,
	        assumptions: (result as any).assumptions,
	        next_action: (result as any).next_action,
	      });
	    }

	    return res.status(200).json({
	      accepted: true,
	      state: result.state,
	      nextQuestion: result.nextQuestion,
	      questionKey: result.questionKey,
	      spec: result.spec,
	      done: result.done,
	      assistant_summary: (result as any).assistant_summary,
	      assumptions: (result as any).assumptions,
	      next_action: (result as any).next_action,
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
      learning_mode: s.learning_mode,
      spec: s.spec,
      messages: s.messages,
      collector: s.collector,
      confidence: s.confidence,
      commitments: s.commitments,
      generationOutcomes: s.generationOutcomes,
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
