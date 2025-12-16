"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const judge_1 = require("./judge");
const javaRun_1 = require("./execution/javaRun");
const database_1 = require("./database");
const sessions_1 = require("./routes/sessions");
const auth_1 = require("./auth");
dotenv_1.default.config();
// Initialize database
(0, database_1.initializeDatabase)();
const app = (0, express_1.default)();
const port = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "1mb" }));
// Codemm v1.0 sessions API (guided SpecBuilder chatbot)
app.use("/sessions", sessions_1.sessionsRouter);
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
            return res.status(400).json({ error: "Only 'java' is supported." });
        }
        // Guard: enforce reasonable code length (basic DoS protection)
        const maxCodeLength = 50000; // 50KB
        if (code.length > maxCodeLength) {
            return res.status(400).json({
                error: `Code exceeds maximum length of ${maxCodeLength} characters.`,
            });
        }
        const result = await (0, javaRun_1.runJavaCodeOnly)(code);
        res.json({ stdout: result.stdout, stderr: result.stderr });
    }
    catch (err) {
        console.error("Error in /run:", err);
        res.status(500).json({ error: "Failed to run code.", detail: err?.message });
    }
});
// Graded execution: MUST include test suite (unit tests).
app.post("/submit", auth_1.optionalAuth, async (req, res) => {
    try {
        const { code, testSuite, activityId, problemId } = req.body ?? {};
        // Guard: graded execution requires non-empty code and test suite
        if (typeof code !== "string" || !code.trim()) {
            return res.status(400).json({ error: "code is required non-empty string." });
        }
        if (typeof testSuite !== "string" || !testSuite.trim()) {
            return res.status(400).json({
                error: "testSuite is required for graded execution. Use /run for code-only execution.",
            });
        }
        const result = await (0, judge_1.runJudge)(code, testSuite);
        // Save submission to database if user is authenticated and owns the activity/problem
        if (req.user && typeof activityId === "string" && typeof problemId === "string") {
            const dbActivity = database_1.activityDb.findById(activityId);
            if (dbActivity && dbActivity.user_id === req.user.id) {
                try {
                    const problems = JSON.parse(dbActivity.problems);
                    const problemExists = problems.some((p) => p.id === problemId);
                    if (problemExists) {
                        const totalTests = result.passedTests.length + result.failedTests.length;
                        database_1.submissionDb.create(req.user.id, activityId, problemId, code, result.success, result.passedTests.length, totalTests, result.executionTimeMs);
                    }
                }
                catch (parseErr) {
                    console.error("Failed to parse activity problems while saving submission:", parseErr);
                }
            }
        }
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
        if (database_1.userDb.findByUsername(username)) {
            return res.status(400).json({ error: "Username already taken" });
        }
        if (database_1.userDb.findByEmail(email)) {
            return res.status(400).json({ error: "Email already registered" });
        }
        // Create user
        const passwordHash = await (0, auth_1.hashPassword)(password);
        const userId = database_1.userDb.create(username, email, passwordHash, displayName);
        // Generate token
        const token = (0, auth_1.generateToken)(userId, username, email);
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
    }
    catch (err) {
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
        let user = database_1.userDb.findByUsername(username);
        if (!user) {
            user = database_1.userDb.findByEmail(username);
        }
        if (!user) {
            return res.status(401).json({ error: "Invalid username or password" });
        }
        // Verify password
        const isValid = await (0, auth_1.comparePassword)(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid username or password" });
        }
        // Generate token
        const token = (0, auth_1.generateToken)(user.id, user.username, user.email);
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
    }
    catch (err) {
        console.error("Error in /auth/login:", err);
        res.status(500).json({ error: "Failed to login" });
    }
});
app.get("/auth/me", auth_1.authenticateToken, (req, res) => {
    const user = database_1.userDb.findById(req.user.id);
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
app.get("/profile", auth_1.authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const user = database_1.userDb.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        // Get user stats
        const stats = database_1.submissionDb.getStatsByUser(userId);
        // Get recent activities
        const dbActivities = database_1.activityDb.findByUserId(userId);
        const activities = dbActivities.map((act) => ({
            id: act.id,
            title: act.title,
            prompt: act.prompt || "",
            problems: JSON.parse(act.problems),
            createdAt: act.created_at,
        }));
        // Get recent submissions
        const recentSubmissions = database_1.submissionDb.findByUser(userId, 10);
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
                successRate: stats.total_submissions > 0
                    ? Math.round(((stats.successful_submissions || 0) / stats.total_submissions) * 100)
                    : 0,
            },
            activities,
            recentSubmissions,
        });
    }
    catch (err) {
        console.error("Error in /profile:", err);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});
// Fetch an existing activity by id for the authenticated user
app.get("/activities/:id", auth_1.authenticateToken, (req, res) => {
    const id = req.params.id;
    const dbActivity = database_1.activityDb.findById(id);
    if (!dbActivity) {
        return res.status(404).json({ error: "Activity not found." });
    }
    // Enforce ownership: users may only access their own activities
    if (dbActivity.user_id !== req.user.id) {
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
app.get("/activities", auth_1.authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const dbActivities = database_1.activityDb.findByUserId(userId);
        const activities = dbActivities.map((act) => ({
            id: act.id,
            title: act.title,
            prompt: act.prompt || "",
            problemCount: JSON.parse(act.problems).length,
            createdAt: act.created_at,
        }));
        res.json({ activities });
    }
    catch (err) {
        console.error("Error in GET /activities:", err);
        res.status(500).json({ error: "Failed to fetch activities" });
    }
});
app.listen(port, () => {
    console.log(`Codem backend listening on port ${port}`);
});
//# sourceMappingURL=server.js.map