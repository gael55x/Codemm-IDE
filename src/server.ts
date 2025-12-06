import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ProblemAgent } from "./agent";
import { Activity, GeneratedProblem } from "./config";
import { runJudge } from "./judge";
import crypto from "crypto";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const agent = new ProblemAgent();

// In-memory activity store for now. In production, replace with DB or persistent storage.
const activities = new Map<string, Activity>();

app.post("/generate", async (req, res) => {
  try {
    const count = typeof req.body?.count === "number" ? req.body.count : 5;
    const prompt =
      typeof req.body?.prompt === "string" && req.body.prompt.trim().length > 0
        ? req.body.prompt
        : undefined;

    const { problems, rawText } = await agent.generateProblems({ count, prompt });

    res.json({
      problems,
      raw: rawText,
    });
  } catch (err: any) {
    console.error("Error in /generate:", err);
    res.status(500).json({ error: "Failed to generate problems.", detail: err?.message });
  }
});

// Simple chat proxy so the frontend can have a conversational setup phase
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required string." });
    }

    // For now, reuse ProblemAgent with a single-turn prompt that includes the user message.
    const wrappedPrompt = `You are the Codem Problem Setup Assistant. First, chat with the user about what Java OOP problems they want (topic, difficulty, number of problems, and time per activity). Do NOT generate problems yet unless the user clearly asks you to.\n\nUser message:\n${message}`;

    const { rawText } = await agent.generateProblems({
      count: 5,
      validate: false,
      enforceCount: false,
      prompt: wrappedPrompt,
    });

    res.json({ reply: rawText });
  } catch (err: any) {
    console.error("Error in /chat:", err);
    res.status(500).json({ error: "Failed to chat with ProblemAgent." });
  }
});

app.post("/submit", async (req, res) => {
  try {
    const { code, testSuite } = req.body ?? {};
    if (typeof code !== "string" || typeof testSuite !== "string") {
      return res.status(400).json({ error: "code and testSuite are required strings." });
    }

    const result = await runJudge(code, testSuite);
    res.json(result);
  } catch (err: any) {
    console.error("Error in /submit:", err);
    res.status(500).json({ error: "Failed to judge submission." });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Create a new activity: generate problems and store them server-side
app.post("/activities", async (req, res) => {
  try {
    const { prompt, count, title } = req.body ?? {};
    const num =
      typeof count === "number" && count > 0 && count <= 20 ? count : 5;

    const cleanPrompt =
      typeof prompt === "string" && prompt.trim().length > 0
        ? prompt
        : undefined;

    const { problems, rawText } = await agent.generateProblems({
      count: num,
      ...(cleanPrompt ? { prompt: cleanPrompt } : {}),
    });

    const id = crypto.randomUUID();
    const activity: Activity = {
      id,
      title:
        typeof title === "string" && title.trim().length > 0
          ? title
          : "Generated Activity",
      prompt: cleanPrompt ?? rawText.slice(0, 500),
      problems,
      createdAt: new Date().toISOString(),
    };
    activities.set(id, activity);

    res.json({
      activityId: id,
      activity,
    });
  } catch (err: any) {
    console.error("Error in /activities:", err);
    res
      .status(500)
      .json({ error: "Failed to create activity.", detail: err?.message });
  }
});

// Fetch an existing activity by id
app.get("/activities/:id", (req, res) => {
  const id = req.params.id;
  const activity = activities.get(id);
  if (!activity) {
    return res.status(404).json({ error: "Activity not found." });
  }
  res.json({ activity });
});

app.listen(port, () => {
  console.log(`Codem backend listening on port ${port}`);
});


