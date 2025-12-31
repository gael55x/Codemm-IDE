import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { z } from "zod";
import { LegacyGeneratedProblem } from "./types";
import { initializeDatabase, userDb, activityDb, submissionDb } from "./database";
import { sessionsRouter } from "./routes/sessions";
import { ActivityLanguageSchema } from "./contracts/activitySpec";
import {
  getLanguageProfile,
  isLanguageSupportedForExecution,
  isLanguageSupportedForJudge,
} from "./languages/profiles";
import {
  hashPassword,
  comparePassword,
  generateToken,
  authenticateToken,
  optionalAuth,
  AuthRequest,
} from "./auth";
import { updateLearnerProfileFromSubmission } from "./services/learnerProfileService";
import { editDraftProblemWithAi } from "./services/activityProblemEditService";
import { encryptSecret } from "./utils/secretBox";

dotenv.config();

// Initialize database
initializeDatabase();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Dev-only request logging (never includes code/prompt payloads).
if (process.env.CODEMM_HTTP_LOG === "1") {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      console.log(`[CODEMM_HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    });
    next();
  });
}

// Codemm v1.0 sessions API (guided SpecBuilder chatbot)
app.use("/sessions", sessionsRouter);

// ==========================
// Codemm v1.0 Execution Modes
// ==========================

// Terminal-style execution: code only, no tests, no persistence, no auth required.
app.post("/run", async (req, res) => {
  try {
    const { code, language, files, mainClass, stdin } = req.body ?? {};

    const langParsed = ActivityLanguageSchema.safeParse(language);
    if (!langParsed.success) {
      return res.status(400).json({ error: "Invalid language." });
    }
    const lang = langParsed.data;

    if (!isLanguageSupportedForExecution(lang)) {
      return res.status(400).json({ error: `Language "${lang}" is not supported for /run yet.` });
    }

    const profile = getLanguageProfile(lang);
    if (!profile.executionAdapter) {
      return res.status(400).json({ error: `No execution adapter configured for "${lang}".` });
    }

    const maxTotalCodeLength = 200_000; // 200KB
    const maxStdinLength = 50_000; // 50KB
    const maxFileCount = lang === "python" ? 20 : lang === "cpp" ? 40 : 12;
    const filenamePattern =
      lang === "python"
        ? /^[A-Za-z_][A-Za-z0-9_]*\.py$/
        : lang === "cpp"
        ? /^[A-Za-z_][A-Za-z0-9_]*\.(?:cpp|h|hpp)$/
        : lang === "sql"
        ? /^[A-Za-z_][A-Za-z0-9_]*\.sql$/
        : /^[A-Za-z_][A-Za-z0-9_]*\.java$/;

    let safeStdin: string | undefined = undefined;
    if (typeof stdin !== "undefined") {
      if (typeof stdin !== "string") {
        return res.status(400).json({ error: "stdin must be a string." });
      }
      if (stdin.length > maxStdinLength) {
        return res
          .status(400)
          .json({ error: `stdin exceeds maximum length of ${maxStdinLength} characters.` });
      }
      safeStdin = stdin;
    }

    if (files && typeof files === "object") {
      const entries = Object.entries(files as Record<string, unknown>);
      if (entries.length === 0) {
        return res.status(400).json({ error: "files must be a non-empty object." });
      }
      if (entries.length > maxFileCount) {
        return res.status(400).json({ error: `Too many files. Max is ${maxFileCount}.` });
      }

      let totalLen = safeStdin?.length ?? 0;
      const safeFiles: Record<string, string> = {};
      for (const [filename, source] of entries) {
        if (typeof filename !== "string" || !filenamePattern.test(filename)) {
          return res.status(400).json({
            error: `Invalid filename "${String(filename)}". Must match ${filenamePattern}.`,
          });
        }
        if (typeof source !== "string" || !source.trim()) {
          return res.status(400).json({ error: `File "${filename}" must be a non-empty string.` });
        }
        totalLen += source.length;
        if (totalLen > maxTotalCodeLength) {
          return res.status(400).json({
            error: `Total code exceeds maximum length of ${maxTotalCodeLength} characters.`,
          });
        }
        safeFiles[filename] = source;
      }

      if (lang === "python") {
        const hasMain = entries.some(([filename]) => filename === "main.py");
        if (!hasMain) {
          return res.status(400).json({ error: 'Python /run requires a "main.py" file.' });
        }
      }
      if (lang === "cpp") {
        const hasMain = entries.some(([filename]) => filename === "main.cpp");
        if (!hasMain) {
          return res.status(400).json({ error: 'C++ /run requires a "main.cpp" file.' });
        }
      }
      if (lang === "sql") {
        return res.status(400).json({ error: 'SQL does not support /run yet. Use /submit (Run tests).' });
      }

      const execReq: {
        kind: "files";
        files: Record<string, string>;
        mainClass?: string;
        stdin?: string;
      } = {
        kind: "files",
        files: safeFiles,
      };
      if (typeof mainClass === "string" && mainClass.trim()) {
        execReq.mainClass = mainClass.trim();
      }
      if (typeof safeStdin === "string") {
        execReq.stdin = safeStdin;
      }

      const result = await profile.executionAdapter.run(execReq);
      return res.json({ stdout: result.stdout, stderr: result.stderr });
    }

    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ error: "Provide either code (string) or files (object)." });
    }

    const total = code.length + (safeStdin?.length ?? 0);
    if (total > maxTotalCodeLength) {
      return res.status(400).json({
        error: `Code exceeds maximum length of ${maxTotalCodeLength} characters.`,
      });
    }

    const execReq: { kind: "code"; code: string; stdin?: string } = { kind: "code", code };
    if (typeof safeStdin === "string") {
      execReq.stdin = safeStdin;
    }
    const result = await profile.executionAdapter.run(execReq);
    res.json({ stdout: result.stdout, stderr: result.stderr });
  } catch (err: any) {
    console.error("Error in /run:", err);
    res.status(500).json({ error: "Failed to run code.", detail: err?.message });
  }
});

// Graded execution: MUST include test suite (unit tests).
app.post("/submit", optionalAuth, async (req: AuthRequest, res) => {
  try {
    const { code, testSuite, activityId, problemId, files, language } = req.body ?? {};
    
    // Guard: graded execution requires non-empty code and test suite
    if (typeof testSuite !== "string" || !testSuite.trim()) {
      return res.status(400).json({
        error: "testSuite is required for graded execution. Use /run for code-only execution.",
      });
    }

    const langParsed = ActivityLanguageSchema.safeParse(language ?? "java");
    if (!langParsed.success) {
      return res.status(400).json({ error: "Invalid language." });
    }
    const lang = langParsed.data;

    if (!isLanguageSupportedForJudge(lang)) {
      return res.status(400).json({ error: `Language "${lang}" is not supported for /submit yet.` });
    }

    const profile = getLanguageProfile(lang);
    if (!profile.judgeAdapter) {
      return res.status(400).json({ error: `No judge adapter configured for "${lang}".` });
    }

    const maxTotalCodeLength = 200_000; // 200KB
    const maxFileCount = lang === "python" ? 30 : lang === "cpp" ? 50 : 16;
    const filenamePattern =
      lang === "python"
        ? /^[A-Za-z_][A-Za-z0-9_]*\.py$/
        : lang === "cpp"
        ? /^[A-Za-z_][A-Za-z0-9_]*\.(?:cpp|h|hpp)$/
        : lang === "sql"
        ? /^[A-Za-z_][A-Za-z0-9_]*\.sql$/
        : /^[A-Za-z_][A-Za-z0-9_]*\.java$/;

    let result;
    let codeForPersistence: string | null = null;

    if (files && typeof files === "object") {
      const entries = Object.entries(files as Record<string, unknown>);
      if (entries.length === 0) {
        return res.status(400).json({ error: "files must be a non-empty object." });
      }
      if (entries.length > maxFileCount) {
        return res.status(400).json({ error: `Too many files. Max is ${maxFileCount}.` });
      }

      let totalLen = testSuite.length;
      const safeFiles: Record<string, string> = {};
      for (const [filename, source] of entries) {
        if (typeof filename !== "string" || !filenamePattern.test(filename)) {
          return res.status(400).json({
            error: `Invalid filename "${String(filename)}". Must match ${filenamePattern}.`,
          });
        }
        if (typeof source !== "string" || !source.trim()) {
          return res.status(400).json({ error: `File "${filename}" must be a non-empty string.` });
        }
        totalLen += source.length;
        if (totalLen > maxTotalCodeLength) {
          return res.status(400).json({
            error: `Total code exceeds maximum length of ${maxTotalCodeLength} characters.`,
          });
        }
        safeFiles[filename] = source;
      }

      if (lang === "python") {
        if (Object.prototype.hasOwnProperty.call(safeFiles, "test_solution.py")) {
          return res.status(400).json({ error: 'files must not include "test_solution.py".' });
        }
        if (!Object.prototype.hasOwnProperty.call(safeFiles, "solution.py")) {
          return res.status(400).json({ error: 'Python /submit requires a "solution.py" file.' });
        }
      }
      if (lang === "cpp") {
        if (Object.prototype.hasOwnProperty.call(safeFiles, "test.cpp")) {
          return res.status(400).json({ error: 'files must not include "test.cpp".' });
        }
        if (!Object.prototype.hasOwnProperty.call(safeFiles, "solution.cpp")) {
          return res.status(400).json({ error: 'C++ /submit requires a "solution.cpp" file.' });
        }
        const cppSources = Object.keys(safeFiles).filter((f) => f.endsWith(".cpp") && f !== "solution.cpp");
        if (cppSources.length > 0) {
          return res.status(400).json({
            error: `C++ /submit supports "solution.cpp" plus optional headers only. Remove: ${cppSources.join(", ")}`,
          });
        }
      }
      if (lang === "sql") {
        if (!Object.prototype.hasOwnProperty.call(safeFiles, "solution.sql")) {
          return res.status(400).json({ error: 'SQL /submit requires a "solution.sql" file.' });
        }
        const extras = Object.keys(safeFiles).filter((f) => f !== "solution.sql");
        if (extras.length > 0) {
          return res.status(400).json({ error: `SQL /submit supports only solution.sql. Remove: ${extras.join(", ")}` });
        }
      }

      result = await profile.judgeAdapter.judge({ kind: "files", files: safeFiles, testSuite });
      codeForPersistence = JSON.stringify(safeFiles);
    } else {
      if (typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ error: "code is required non-empty string." });
      }
      if (code.length + testSuite.length > maxTotalCodeLength) {
        return res.status(400).json({
          error: `Total code exceeds maximum length of ${maxTotalCodeLength} characters.`,
        });
      }
      result = await profile.judgeAdapter.judge({ kind: "code", code, testSuite });
      codeForPersistence = code;
    }

    // Save submission to database if user is authenticated and owns the activity/problem
    if (req.user && typeof activityId === "string" && typeof problemId === "string") {
      const dbActivity = activityDb.findById(activityId);
      if (dbActivity && dbActivity.user_id === req.user.id) {
        try {
          const problems: LegacyGeneratedProblem[] = JSON.parse(dbActivity.problems);
          const problemExists = problems.some((p) => p.id === problemId);

          if (problemExists) {
            const totalTests = result.passedTests.length + result.failedTests.length;
            submissionDb.create(
              req.user.id,
              activityId,
              problemId,
              codeForPersistence ?? "",
              result.success,
              result.passedTests.length,
              totalTests,
              result.executionTimeMs
            );

            updateLearnerProfileFromSubmission({
              userId: req.user.id,
              language: lang,
              activityId,
              problemId,
              success: result.success,
            });
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

// ============ Per-user LLM key routes (encrypted at rest) ============

const LlmProviderSchema = z.enum(["openai", "anthropic", "gemini"]);
const UpsertUserLlmKeySchema = z
  .object({
    provider: LlmProviderSchema,
    apiKey: z.string().trim().min(10).max(400),
  })
  .strict();

app.get("/profile/llm", authenticateToken, (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const cfg = userDb.getLlmConfig(userId);
    const configured = Boolean(cfg?.llm_provider && cfg?.llm_api_key_enc);
    return res.json({
      configured,
      provider: configured ? cfg!.llm_provider : null,
      updatedAt: configured ? cfg!.llm_api_key_updated_at : null,
    });
  } catch (err: any) {
    console.error("Error in GET /profile/llm:", err);
    return res.status(500).json({ error: "Failed to fetch LLM settings." });
  }
});

app.put("/profile/llm", authenticateToken, (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const parsed = UpsertUserLlmKeySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." });
    }

    const apiKeyEnc = encryptSecret(parsed.data.apiKey);
    userDb.setLlmConfig(userId, parsed.data.provider, apiKeyEnc);
    return res.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/CODEMM_USER_KEY_ENCRYPTION_KEY/i.test(msg)) {
      return res.status(501).json({
        error: "Server is not configured to store per-user API keys.",
        detail: msg,
      });
    }
    console.error("Error in PUT /profile/llm:", err);
    return res.status(500).json({ error: "Failed to save LLM settings." });
  }
});

app.delete("/profile/llm", authenticateToken, (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    userDb.clearLlmConfig(userId);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Error in DELETE /profile/llm:", err);
    return res.status(500).json({ error: "Failed to clear LLM settings." });
  }
});

// Fetch an existing activity by id for the authenticated user
app.get("/activities/:id", optionalAuth, (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const dbActivity = activityDb.findById(id);

  if (!dbActivity) {
    return res.status(404).json({ error: "Activity not found." });
  }

  const isOwner = Boolean(req.user && dbActivity.user_id === req.user.id);
  const isPublished = dbActivity.status === "PUBLISHED";

  // Draft activities are private; published activities can be viewed by anyone.
  if (!isOwner && !isPublished) {
    return res.status(403).json({ error: "You are not authorized to access this activity." });
  }

  res.json({
    activity: {
      id: dbActivity.id,
      title: dbActivity.title,
      prompt: dbActivity.prompt || "",
      problems: JSON.parse(dbActivity.problems),
      status: dbActivity.status ?? "PUBLISHED",
      timeLimitSeconds: typeof dbActivity.time_limit_seconds === "number" ? dbActivity.time_limit_seconds : null,
      communityPublishedAt: dbActivity.community_published_at ?? null,
      communitySummary: dbActivity.community_summary ?? null,
      communityTags: (() => {
        try {
          return dbActivity.community_tags ? JSON.parse(dbActivity.community_tags) : [];
        } catch {
          return [];
        }
      })(),
      createdAt: dbActivity.created_at,
    },
  });
});

const CommunityListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

// Public: list community-published activities (discoverable)
app.get("/community/activities", (req, res) => {
  const parsed = CommunityListQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query." });
  }
  const limit = parsed.data.limit ?? 20;
  const offset = parsed.data.offset ?? 0;

  try {
    const rows = activityDb.listCommunity(limit, offset);
    const activities = rows.map((a) => {
      let problemCount = 0;
      try {
        const parsedProblems = JSON.parse(a.problems);
        problemCount = Array.isArray(parsedProblems) ? parsedProblems.length : 0;
      } catch {
        problemCount = 0;
      }
      let tags: string[] = [];
      try {
        const parsedTags = a.community_tags ? JSON.parse(a.community_tags) : [];
        tags = Array.isArray(parsedTags) ? parsedTags.filter((t) => typeof t === "string") : [];
      } catch {
        tags = [];
      }

      return {
        id: a.id,
        title: a.title,
        communitySummary: a.community_summary ?? null,
        communityTags: tags,
        communityPublishedAt: a.community_published_at ?? null,
        createdAt: a.created_at,
        problemCount,
        author: {
          username: (a as any).author_username as string,
          displayName: (a as any).author_display_name as string,
        },
      };
    });

    return res.json({
      activities,
      nextOffset: activities.length === limit ? offset + limit : null,
    });
  } catch (err: any) {
    console.error("Error in GET /community/activities:", err);
    return res.status(500).json({ error: "Failed to fetch community activities." });
  }
});

// Public: fetch a single community-published activity
app.get("/community/activities/:id", (req, res) => {
  const id = req.params.id as string;
  try {
    const row = activityDb.findCommunityById(id);
    if (!row) return res.status(404).json({ error: "Community activity not found." });

    let tags: string[] = [];
    try {
      const parsedTags = row.community_tags ? JSON.parse(row.community_tags) : [];
      tags = Array.isArray(parsedTags) ? parsedTags.filter((t) => typeof t === "string") : [];
    } catch {
      tags = [];
    }

    return res.json({
      activity: {
        id: row.id,
        title: row.title,
        prompt: row.prompt || "",
        problems: (() => {
          try {
            const parsedProblems = JSON.parse(row.problems);
            return Array.isArray(parsedProblems) ? parsedProblems : [];
          } catch {
            return [];
          }
        })(),
        status: row.status ?? "PUBLISHED",
        timeLimitSeconds: typeof row.time_limit_seconds === "number" ? row.time_limit_seconds : null,
        communityPublishedAt: row.community_published_at ?? null,
        communitySummary: row.community_summary ?? null,
        communityTags: tags,
        createdAt: row.created_at,
        author: {
          username: (row as any).author_username as string,
          displayName: (row as any).author_display_name as string,
        },
      },
    });
  } catch (err: any) {
    console.error("Error in GET /community/activities/:id:", err);
    return res.status(500).json({ error: "Failed to fetch community activity." });
  }
});

const UpdateActivitySchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    timeLimitSeconds: z.number().int().min(0).max(8 * 60 * 60).nullable().optional(),
  })
  .strict();

app.patch("/activities/:id", authenticateToken, (req: AuthRequest, res) => {
  const id = req.params.id as string;

  const parsed = UpdateActivitySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." });
  }
  const { title, timeLimitSeconds } = parsed.data;

  const dbActivity = activityDb.findById(id);
  if (!dbActivity) {
    return res.status(404).json({ error: "Activity not found." });
  }
  if (dbActivity.user_id !== req.user!.id) {
    return res.status(403).json({ error: "You are not authorized to edit this activity." });
  }
  if ((dbActivity.status ?? "PUBLISHED") !== "DRAFT") {
    return res.status(409).json({ error: "This activity has already been published." });
  }

  const updated = activityDb.updateByOwner(id, req.user!.id, {
    ...(typeof title === "string" ? { title } : {}),
    ...(typeof timeLimitSeconds !== "undefined" ? { time_limit_seconds: timeLimitSeconds } : {}),
  });

  if (!updated) {
    return res.status(500).json({ error: "Failed to update activity." });
  }

  res.json({
    activity: {
      id: updated.id,
      title: updated.title,
      prompt: updated.prompt || "",
      problems: JSON.parse(updated.problems),
      status: updated.status ?? "PUBLISHED",
      timeLimitSeconds: typeof updated.time_limit_seconds === "number" ? updated.time_limit_seconds : null,
      createdAt: updated.created_at,
    },
  });
});

const EditActivityProblemSchema = z
  .object({
    instruction: z.string().trim().min(1).max(2000),
  })
  .strict();

app.post("/activities/:id/problems/:problemId/ai-edit", authenticateToken, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const problemId = req.params.problemId as string;

  const parsed = EditActivityProblemSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." });
  }

  const dbActivity = activityDb.findById(id);
  if (!dbActivity) {
    return res.status(404).json({ error: "Activity not found." });
  }
  if (dbActivity.user_id !== req.user!.id) {
    return res.status(403).json({ error: "You are not authorized to edit this activity." });
  }
  if ((dbActivity.status ?? "PUBLISHED") !== "DRAFT") {
    return res.status(409).json({ error: "This activity has already been published." });
  }

  let problems: any[] = [];
  try {
    const parsedProblems = JSON.parse(dbActivity.problems);
    problems = Array.isArray(parsedProblems) ? parsedProblems : [];
  } catch {
    return res.status(500).json({ error: "Failed to load activity problems." });
  }

  const idx = problems.findIndex((p) => p && typeof p === "object" && (p as any).id === problemId);
  if (idx < 0) {
    return res.status(404).json({ error: "Problem not found." });
  }

  try {
    const updatedProblem = await editDraftProblemWithAi({
      existing: problems[idx],
      instruction: parsed.data.instruction,
    });
    const nextProblems = [...problems];
    nextProblems[idx] = updatedProblem;

    const updated = activityDb.updateByOwner(id, req.user!.id, { problems: JSON.stringify(nextProblems) });
    if (!updated) {
      return res.status(500).json({ error: "Failed to update activity." });
    }

    return res.json({
      activity: {
        id: updated.id,
        title: updated.title,
        prompt: updated.prompt || "",
        problems: JSON.parse(updated.problems),
        status: updated.status ?? "PUBLISHED",
        timeLimitSeconds: typeof updated.time_limit_seconds === "number" ? updated.time_limit_seconds : null,
        createdAt: updated.created_at,
      },
    });
  } catch (err: any) {
    console.error("Error in POST /activities/:id/problems/:problemId/ai-edit:", err);
    return res.status(500).json({ error: err?.message ?? "Failed to edit problem." });
  }
});

app.post("/activities/:id/publish", authenticateToken, (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const dbActivity = activityDb.findById(id);

  if (!dbActivity) {
    return res.status(404).json({ error: "Activity not found." });
  }
  if (dbActivity.user_id !== req.user!.id) {
    return res.status(403).json({ error: "You are not authorized to publish this activity." });
  }

  if ((dbActivity.status ?? "PUBLISHED") === "PUBLISHED") {
    return res.json({ ok: true });
  }

  activityDb.updateByOwner(id, req.user!.id, { status: "PUBLISHED" });
  return res.json({ ok: true });
});

const PublishToCommunitySchema = z
  .object({
    summary: z.string().trim().min(1).max(240).optional(),
    tags: z
      .array(z.string().trim().min(1).max(24))
      .max(10)
      .optional(),
  })
  .strict();

// Owner-only: publish a (already published) activity to the community for discovery.
app.post("/activities/:id/community/publish", authenticateToken, (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const parsed = PublishToCommunitySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." });
  }

  const dbActivity = activityDb.findById(id);
  if (!dbActivity) {
    return res.status(404).json({ error: "Activity not found." });
  }
  if (dbActivity.user_id !== req.user!.id) {
    return res.status(403).json({ error: "You are not authorized to publish this activity to the community." });
  }

  if ((dbActivity.status ?? "PUBLISHED") !== "PUBLISHED") {
    return res.status(409).json({ error: "Publish the activity first before sharing it to the community." });
  }

  const now = new Date().toISOString();
  const nextSummary =
    typeof parsed.data.summary === "string" ? parsed.data.summary : (dbActivity.community_summary ?? null);
  const nextTags =
    Array.isArray(parsed.data.tags) ? JSON.stringify(parsed.data.tags) : (dbActivity.community_tags ?? null);

  const updated = activityDb.updateByOwner(id, req.user!.id, {
    community_published_at: dbActivity.community_published_at ?? now,
    community_summary: nextSummary,
    community_tags: nextTags,
  });

  if (!updated) {
    return res.status(500).json({ error: "Failed to publish to community." });
  }

  return res.json({ ok: true, communityPublishedAt: updated.community_published_at ?? null });
});

// Owner-only: remove an activity from the community feed.
app.post("/activities/:id/community/unpublish", authenticateToken, (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const dbActivity = activityDb.findById(id);
  if (!dbActivity) {
    return res.status(404).json({ error: "Activity not found." });
  }
  if (dbActivity.user_id !== req.user!.id) {
    return res.status(403).json({ error: "You are not authorized to unpublish this activity." });
  }

  const updated = activityDb.updateByOwner(id, req.user!.id, { community_published_at: null });
  if (!updated) {
    return res.status(500).json({ error: "Failed to unpublish from community." });
  }
  return res.json({ ok: true });
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
      status: act.status ?? "PUBLISHED",
      timeLimitSeconds: typeof act.time_limit_seconds === "number" ? act.time_limit_seconds : null,
      communityPublishedAt: act.community_published_at ?? null,
      createdAt: act.created_at,
    }));

    res.json({ activities });
  } catch (err: any) {
    console.error("Error in GET /activities:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

export { app };

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Codem backend listening on port ${port}`);
  });
}
