import express from "express";
import cors from "cors";
import dotenv from "dotenv";
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

dotenv.config();

// Initialize database
initializeDatabase();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

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

  res.json({
    activity: {
      id: dbActivity.id,
      title: dbActivity.title,
      prompt: dbActivity.prompt || "",
      problems: JSON.parse(dbActivity.problems),
      createdAt: dbActivity.created_at,
    },
  });
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
