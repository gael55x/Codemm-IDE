import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ProblemAgent } from "./agent";
import { Activity, GeneratedProblem } from "./config";
import { runJudge } from "./judge";
import { runJavaCodeOnly } from "./execution/javaRun";
import crypto from "crypto";
import { initializeDatabase, userDb, activityDb, submissionDb, DBActivity } from "./database";
import { sessionsRouter } from "./routes/sessions";
import {
  hashPassword,
  comparePassword,
  generateToken,
  authenticateToken,
  optionalAuth,
  AuthRequest,
} from "./auth";

dotenv.config();

// Initialize database
initializeDatabase();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const agent = new ProblemAgent();

// Codemm v1.0 sessions API (guided SpecBuilder chatbot)
app.use("/sessions", sessionsRouter);

// ==========================
// Codemm v1.0 Execution Modes
// ==========================

// Terminal-style execution: code only, no tests, no persistence, no auth required.
app.post("/run", async (req, res) => {
  try {
    const { code, language } = req.body ?? {};
    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ error: "code is required string." });
    }
    if (language !== "java") {
      return res.status(400).json({ error: "language must be 'java'." });
    }

    const result = await runJavaCodeOnly(code);
    res.json({ stdout: result.stdout, stderr: result.stderr });
  } catch (err: any) {
    console.error("Error in /run:", err);
    res.status(500).json({ error: "Failed to run code.", detail: err?.message });
  }
});

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

app.post("/submit", optionalAuth, async (req: AuthRequest, res) => {
  try {
    const { code, testSuite, activityId, problemId } = req.body ?? {};
    // Graded execution only: MUST include non-empty test suite.
    if (typeof code !== "string" || typeof testSuite !== "string" || !testSuite.trim()) {
      return res.status(400).json({ error: "code and testSuite are required strings." });
    }

    const result = await runJudge(code, testSuite);

    // Save submission to database if user is authenticated and owns the activity/problem
    if (req.user && typeof activityId === "string" && typeof problemId === "string") {
      const dbActivity = activityDb.findById(activityId);
      if (dbActivity && dbActivity.user_id === req.user.id) {
        try {
          const problems: GeneratedProblem[] = JSON.parse(dbActivity.problems);
          const problemExists = problems.some((p) => p.id === problemId);

          if (problemExists) {
            const totalTests = result.passedTests.length + result.failedTests.length;
            submissionDb.create(
              req.user.id,
              activityId,
              problemId,
              code,
              result.success,
              result.passedTests.length,
              totalTests,
              result.executionTimeMs
            );
          }
        } catch (parseErr) {
          console.error("Failed to parse activity problems while saving submission:", parseErr);
        }
      }
    }

    res.json(result);
  } catch (err: any) {
    console.error("Error in /submit:", err);
    res.status(500).json({ error: "Failed to judge submission." });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Authentication Routes 

app.post("/auth/register", async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Username, email, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    if (userDb.findByUsername(username)) {
      return res.status(400).json({ error: "Username already taken" });
    }

    if (userDb.findByEmail(email)) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const userId = userDb.create(username, email, passwordHash, displayName);

    // Generate token
    const token = generateToken(userId, username, email);

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: userId,
        username,
        email,
        displayName: displayName || username,
      },
    });
  } catch (err: any) {
    console.error("Error in /auth/register:", err);
    res.status(500).json({ error: "Failed to register user" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    // Find user (allow login with email or username)
    let user = userDb.findByUsername(username);
    if (!user) {
      user = userDb.findByEmail(username);
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Verify password
    const isValid = await comparePassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Generate token
    const token = generateToken(user.id, user.username, user.email);

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name || user.username,
      },
    });
  } catch (err: any) {
    console.error("Error in /auth/login:", err);
    res.status(500).json({ error: "Failed to login" });
  }
});

app.get("/auth/me", authenticateToken, (req: AuthRequest, res) => {
  const user = userDb.findById(req.user!.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name || user.username,
    createdAt: user.created_at,
  });
});

// ============ Profile Routes ============

app.get("/profile", authenticateToken, (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const user = userDb.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get user stats
    const stats = submissionDb.getStatsByUser(userId);

    // Get recent activities
    const dbActivities = activityDb.findByUserId(userId);
    const activities = dbActivities.map((act) => ({
      id: act.id,
      title: act.title,
      prompt: act.prompt || "",
      problems: JSON.parse(act.problems),
      createdAt: act.created_at,
    }));

    // Get recent submissions
    const recentSubmissions = submissionDb.findByUser(userId, 10);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name || user.username,
        createdAt: user.created_at,
      },
      stats: {
        totalSubmissions: stats.total_submissions || 0,
        successfulSubmissions: stats.successful_submissions || 0,
        activitiesAttempted: stats.activities_attempted || 0,
        problemsAttempted: stats.problems_attempted || 0,
        avgExecutionTime: stats.avg_execution_time || 0,
        successRate:
          stats.total_submissions > 0
            ? Math.round(((stats.successful_submissions || 0) / stats.total_submissions) * 100)
            : 0,
      },
      activities,
      recentSubmissions,
    });
  } catch (err: any) {
    console.error("Error in /profile:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Create a new activity: generate problems and store them in database
app.post("/activities", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { prompt, count, title } = req.body ?? {};
    const userId = req.user!.id;
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
    const activityTitle =
      typeof title === "string" && title.trim().length > 0
        ? title
        : "Generated Activity";

    const activity: Activity = {
      id,
      title: activityTitle,
      prompt: cleanPrompt ?? rawText.slice(0, 500),
      problems,
      createdAt: new Date().toISOString(),
    };

    // Save to database
    activityDb.create(
      id,
      userId,
      activityTitle,
      JSON.stringify(problems),
      cleanPrompt ?? rawText.slice(0, 500)
    );

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

// Fetch an existing activity by id for the authenticated user
app.get("/activities/:id", authenticateToken, (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const dbActivity = activityDb.findById(id);

  if (!dbActivity) {
    return res.status(404).json({ error: "Activity not found." });
  }

  // Enforce ownership: users may only access their own activities
  if (dbActivity.user_id !== req.user!.id) {
    return res.status(403).json({ error: "You are not authorized to access this activity." });
  }

  const activity: Activity = {
    id: dbActivity.id,
    title: dbActivity.title,
    prompt: dbActivity.prompt || "",
    problems: JSON.parse(dbActivity.problems),
    createdAt: dbActivity.created_at,
  };

  res.json({ activity });
});

// Get all activities for the authenticated user
app.get("/activities", authenticateToken, (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const dbActivities = activityDb.findByUserId(userId);
    
    const activities = dbActivities.map((act) => ({
      id: act.id,
      title: act.title,
      prompt: act.prompt || "",
      problemCount: JSON.parse(act.problems).length,
      createdAt: act.created_at,
    }));

    res.json({ activities });
  } catch (err: any) {
    console.error("Error in GET /activities:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

app.listen(port, () => {
  console.log(`Codem backend listening on port ${port}`);
});


