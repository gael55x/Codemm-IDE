"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const agent_1 = require("./agent");
const judge_1 = require("./judge");
const crypto_1 = __importDefault(require("crypto"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "1mb" }));
const agent = new agent_1.ProblemAgent();
// In-memory activity store for now. In production, replace with DB or persistent storage.
const activities = new Map();
app.post("/generate", async (req, res) => {
    try {
        const count = typeof req.body?.count === "number" ? req.body.count : 5;
        const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim().length > 0
            ? req.body.prompt
            : undefined;
        const { problems, rawText } = await agent.generateProblems({ count, prompt });
        res.json({
            problems,
            raw: rawText,
        });
    }
    catch (err) {
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
    }
    catch (err) {
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
        const result = await (0, judge_1.runJudge)(code, testSuite);
        res.json(result);
    }
    catch (err) {
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
        const num = typeof count === "number" && count > 0 && count <= 20 ? count : 5;
        const cleanPrompt = typeof prompt === "string" && prompt.trim().length > 0
            ? prompt
            : undefined;
        const { problems, rawText } = await agent.generateProblems({
            count: num,
            ...(cleanPrompt ? { prompt: cleanPrompt } : {}),
        });
        const id = crypto_1.default.randomUUID();
        const activity = {
            id,
            title: typeof title === "string" && title.trim().length > 0
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
    }
    catch (err) {
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
//# sourceMappingURL=server.js.map