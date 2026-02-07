import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";

// Load `.env` early so CODEMM_DB_PATH can be used even when this module is imported before `dotenv.config()`.
dotenv.config();

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveDirPath(p: string): string {
  const expanded = expandTilde(p);
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

function resolveDbFilePath(p: string): string {
  const resolved = resolveDirPath(p);
  ensureDir(path.dirname(resolved));
  return resolved;
}

function pickWritableDataDir(preferredDir: string): string {
  try {
    ensureDir(preferredDir);
    return preferredDir;
  } catch (err) {
    const cwdDir = path.join(process.cwd(), ".codemm");
    try {
      ensureDir(cwdDir);
      // eslint-disable-next-line no-console
      console.warn(`[db] Falling back to writable data dir: ${cwdDir} (preferred failed: ${preferredDir})`, err);
      return cwdDir;
    } catch {
      const tmpDir = path.join(os.tmpdir(), "codemm");
      ensureDir(tmpDir);
      // eslint-disable-next-line no-console
      console.warn(`[db] Falling back to temp data dir: ${tmpDir} (preferred failed: ${preferredDir})`, err);
      return tmpDir;
    }
  }
}

function getDefaultDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Codemm");
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Codemm");
  }

  const xdg = typeof process.env.XDG_DATA_HOME === "string" ? process.env.XDG_DATA_HOME.trim() : "";
  if (xdg) return path.join(xdg, "codemm");
  return path.join(os.homedir(), ".local", "share", "codemm");
}

const envDbPath = process.env.CODEMM_DB_PATH;
const envDbDir = process.env.CODEMM_DB_DIR;
let dbPath: string;

if (typeof envDbPath === "string" && envDbPath.trim()) {
  const trimmed = envDbPath.trim();
  dbPath = trimmed === ":memory:" ? ":memory:" : resolveDbFilePath(trimmed);
} else {
  const dataDir =
    typeof envDbDir === "string" && envDbDir.trim()
      ? resolveDirPath(envDbDir.trim())
      : pickWritableDataDir(getDefaultDataDir());

  ensureDir(dataDir);
  dbPath = path.join(dataDir, "codemm.db");
}

let db: Database.Database;
try {
  db = new Database(dbPath);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[db] Failed to open SQLite DB at: ${dbPath}`);
  throw err;
}

// Enable foreign keys
db.pragma("foreign_keys = ON");
// Be resilient to transient locks (multiple readers/writers in dev).
db.pragma("busy_timeout = 5000");

// Initialize database schema
export function initializeDatabase() {
  // ==========================================================
  // IDE-first persistence (local-only, no auth/user accounts)
  // ==========================================================
  //
  // Note: legacy SaaS-era DBs may still contain users/community tables/columns.
  // New workspaces should use a fresh DB file and the schema below.

  // sessions (local threads; name kept for transitional compatibility)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      learning_mode TEXT NOT NULL DEFAULT 'practice',
      spec_json TEXT NOT NULL,
      plan_json TEXT,
      problems_json TEXT,
      activity_id TEXT,
      last_error TEXT,
      confidence_json TEXT,
      intent_trace_json TEXT,
      commitments_json TEXT,
      generation_outcomes_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      -- no foreign keys: local-only store
    )
  `);

  // Lightweight migrations for older DBs (SQLite can't add columns in CREATE TABLE IF NOT EXISTS).
  const sessionCols = db
    .prepare(`PRAGMA table_info(sessions)`)
    .all() as { name: string }[];
  const sessionColSet = new Set(sessionCols.map((c) => c.name));

  if (!sessionColSet.has("confidence_json")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN confidence_json TEXT`);
  }
  if (!sessionColSet.has("intent_trace_json")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN intent_trace_json TEXT`);
  }
  if (!sessionColSet.has("commitments_json")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN commitments_json TEXT`);
  }
  if (!sessionColSet.has("generation_outcomes_json")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN generation_outcomes_json TEXT`);
  }
  if (!sessionColSet.has("learning_mode")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'practice'`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_collectors (
      session_id TEXT PRIMARY KEY,
      current_question_key TEXT,
      buffer_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  // Activities table
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT,
      problems TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      time_limit_seconds INTEGER,
      created_at TEXT NOT NULL
      -- no foreign keys: local-only store
    )
  `);

  const activityCols = db
    .prepare(`PRAGMA table_info(activities)`)
    .all() as { name: string }[];
  const activityColSet = new Set(activityCols.map((c) => c.name));

  if (!activityColSet.has("status")) {
    db.exec(`ALTER TABLE activities ADD COLUMN status TEXT NOT NULL DEFAULT 'DRAFT'`);
  }
  if (!activityColSet.has("time_limit_seconds")) {
    db.exec(`ALTER TABLE activities ADD COLUMN time_limit_seconds INTEGER`);
  }

  // Submissions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      code TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      passed_tests INTEGER NOT NULL,
      total_tests INTEGER NOT NULL,
      execution_time_ms INTEGER,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
    CREATE INDEX IF NOT EXISTS idx_session_messages_session_id ON session_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_collectors_session_id ON session_collectors(session_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_activity_id ON submissions(activity_id);
  `);

  console.log("Database initialized successfully");
}

export interface DBActivity {
  id: string;
  title: string;
  prompt?: string;
  problems: string; // JSON string
  status?: string;
  time_limit_seconds?: number | null;
  created_at: string;
}

export interface Submission {
  id: number;
  activity_id: string;
  problem_id: string;
  code: string;
  success: boolean;
  passed_tests: number;
  total_tests: number;
  execution_time_ms?: number;
  submitted_at: string;
}

export interface DBSession {
  id: string;
  state: string;
  learning_mode?: string | null;
  spec_json: string;
  plan_json?: string | null;
  problems_json?: string | null;
  activity_id?: string | null;
  last_error?: string | null;
  confidence_json?: string | null;
  intent_trace_json?: string | null;
  commitments_json?: string | null;
  generation_outcomes_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBSessionSummary {
  id: string;
  state: string;
  learning_mode: string | null;
  created_at: string;
  updated_at: string;
  activity_id: string | null;
  last_message: string | null;
  last_message_at: string | null;
  message_count: number;
}

export interface DBLearnerProfile {
  // removed (SaaS/user-account concept)
}

export interface DBSessionMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface DBSessionCollector {
  session_id: string;
  current_question_key: string | null;
  buffer_json: string;
  created_at: string;
  updated_at: string;
}

// User operations
export const userDb = undefined as never;

// Activity operations
export const activityDb = {
  create: (
    id: string,
    title: string,
    problems: string,
    prompt?: string,
    opts?: { status?: "DRAFT" | "PUBLISHED"; timeLimitSeconds?: number | null }
  ) => {
    const stmt = db.prepare(
      `INSERT INTO activities (id, title, prompt, problems, status, time_limit_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    );
    const status = opts?.status ?? "DRAFT";
    const timeLimitSeconds = typeof opts?.timeLimitSeconds === "number" ? opts.timeLimitSeconds : null;
    stmt.run(id, title, prompt || "", problems, status, timeLimitSeconds);
  },

  findById: (id: string): DBActivity | undefined => {
    const stmt = db.prepare(`SELECT * FROM activities WHERE id = ?`);
    return stmt.get(id) as DBActivity | undefined;
  },

  listAll: (limit: number = 50): DBActivity[] => {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const stmt = db.prepare(`SELECT * FROM activities ORDER BY created_at DESC LIMIT ?`);
    return stmt.all(safeLimit) as DBActivity[];
  },

  delete: (id: string) => {
    const stmt = db.prepare(`DELETE FROM activities WHERE id = ?`);
    stmt.run(id);
  },

  update: (
    id: string,
    patch: {
      title?: string;
      prompt?: string;
      problems?: string;
      time_limit_seconds?: number | null;
      status?: "DRAFT" | "PUBLISHED";
    }
  ): DBActivity | undefined => {
    const sets: string[] = [];
    const args: any[] = [];

    if (typeof patch.title === "string") {
      sets.push("title = ?");
      args.push(patch.title);
    }
    if (typeof patch.prompt === "string") {
      sets.push("prompt = ?");
      args.push(patch.prompt);
    }
    if (typeof patch.problems === "string") {
      sets.push("problems = ?");
      args.push(patch.problems);
    }
    if (typeof patch.time_limit_seconds !== "undefined") {
      sets.push("time_limit_seconds = ?");
      args.push(patch.time_limit_seconds ?? null);
    }
    if (typeof patch.status === "string") {
      sets.push("status = ?");
      args.push(patch.status);
    }

    if (sets.length === 0) return activityDb.findById(id);

    const stmt = db.prepare(`UPDATE activities SET ${sets.join(", ")} WHERE id = ?`);
    stmt.run(...args, id);
    return activityDb.findById(id);
  },
};

// Submission operations
export const submissionDb = {
  create: (
    activityId: string,
    problemId: string,
    code: string,
    success: boolean,
    passedTests: number,
    totalTests: number,
    executionTimeMs?: number
  ) => {
    const stmt = db.prepare(
      `INSERT INTO submissions (activity_id, problem_id, code, success, passed_tests, total_tests, execution_time_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      activityId,
      problemId,
      code,
      success ? 1 : 0,
      passedTests,
      totalTests,
      executionTimeMs || null
    );
    return result.lastInsertRowid as number;
  },

  findByActivityAndProblem: (activityId: string, problemId: string): Submission[] => {
    const stmt = db.prepare(
      `SELECT * FROM submissions 
       WHERE activity_id = ? AND problem_id = ?
       ORDER BY submitted_at DESC`
    );
    return stmt.all(activityId, problemId) as Submission[];
  },
};

// Codemm v1.0 Session operations (contract-driven)
export const sessionDb = {
  create: (
    id: string,
    state: string,
    learningMode: string,
    specJson: string
  ) => {
    const stmt = db.prepare(
      `INSERT INTO sessions (id, state, learning_mode, spec_json, confidence_json, intent_trace_json, commitments_json, generation_outcomes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    );
    stmt.run(id, state, learningMode, specJson, "{}", "[]", "[]", "[]");
  },

  findById: (id: string): DBSession | undefined => {
    const stmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
    return stmt.get(id) as DBSession | undefined;
  },

  updateState: (id: string, state: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET state = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(state, id);
  },

  updateSpecJson: (id: string, specJson: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET spec_json = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(specJson, id);
  },

  setPlanJson: (id: string, planJson: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET plan_json = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(planJson, id);
  },

  setProblemsJson: (id: string, problemsJson: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET problems_json = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(problemsJson, id);
  },

  setActivityId: (id: string, activityId: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET activity_id = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(activityId, id);
  },

  setLastError: (id: string, error: string | null) => {
    const stmt = db.prepare(
      `UPDATE sessions SET last_error = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(error, id);
  },

  updateConfidenceJson: (id: string, confidenceJson: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET confidence_json = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(confidenceJson, id);
  },

  updateIntentTraceJson: (id: string, traceJson: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET intent_trace_json = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(traceJson, id);
  },

  updateCommitmentsJson: (id: string, commitmentsJson: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET commitments_json = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(commitmentsJson, id);
  },

  updateGenerationOutcomesJson: (id: string, outcomesJson: string) => {
    const stmt = db.prepare(
      `UPDATE sessions SET generation_outcomes_json = ?, updated_at = datetime('now') WHERE id = ?`
    );
    stmt.run(outcomesJson, id);
  },

  listSummaries: (limit: number = 50): DBSessionSummary[] => {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const stmt = db.prepare(`
      SELECT
        s.id,
        s.state,
        s.learning_mode,
        s.created_at,
        s.updated_at,
        s.activity_id,
        (
          SELECT m.content
          FROM session_messages m
          WHERE m.session_id = s.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT m.created_at
          FROM session_messages m
          WHERE m.session_id = s.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT COUNT(*)
          FROM session_messages m
          WHERE m.session_id = s.id
        ) AS message_count
      FROM sessions s
      ORDER BY COALESCE(last_message_at, s.updated_at) DESC
      LIMIT ?
    `);
    return stmt.all(safeLimit) as DBSessionSummary[];
  },
};

export const sessionCollectorDb = {
  upsert: (sessionId: string, currentQuestionKey: string | null, buffer: string[]) => {
    const stmt = db.prepare(
      `INSERT INTO session_collectors (session_id, current_question_key, buffer_json, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(session_id) DO UPDATE SET
         current_question_key = excluded.current_question_key,
         buffer_json = excluded.buffer_json,
         updated_at = datetime('now')`
    );
    stmt.run(sessionId, currentQuestionKey ?? null, JSON.stringify(buffer));
  },

  findBySessionId: (sessionId: string): DBSessionCollector | undefined => {
    const stmt = db.prepare(`SELECT * FROM session_collectors WHERE session_id = ?`);
    return stmt.get(sessionId) as DBSessionCollector | undefined;
  },
};

export const sessionMessageDb = {
  create: (id: string, sessionId: string, role: "user" | "assistant", content: string) => {
    const stmt = db.prepare(
      `INSERT INTO session_messages (id, session_id, role, content, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );
    stmt.run(id, sessionId, role, content);
  },

  findBySessionId: (sessionId: string): DBSessionMessage[] => {
    const stmt = db.prepare(
      `SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC`
    );
    return stmt.all(sessionId) as DBSessionMessage[];
  },
};

export const learnerProfileDb = undefined as never;

export default db;
