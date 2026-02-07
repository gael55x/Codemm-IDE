import crypto from "crypto";
import { initializeDatabase, activityDb, sessionDb, sessionMessageDb, submissionDb } from "./database";
import type { LearningMode } from "./contracts/learningMode";
import { createSession, generateFromSession, getSession, processSessionMessage } from "./services/sessionService";
import { ActivityLanguageSchema } from "./contracts/activitySpec";
import {
  getLanguageProfile,
  isLanguageSupportedForExecution,
  isLanguageSupportedForJudge,
} from "./languages/profiles";
import type { GenerationProgressEvent } from "./contracts/generationProgress";
import { getGenerationProgressBuffer, subscribeGenerationProgress } from "./generation/progressBus";
import { editDraftProblemWithAi } from "./services/activityProblemEditService";

type JsonObject = Record<string, unknown>;

type RpcRequest = {
  id: string;
  type: "req";
  method: string;
  params?: JsonObject;
};

type RpcResponse =
  | { id: string; type: "res"; ok: true; result: unknown }
  | { id: string; type: "res"; ok: false; error: { message: string; stack?: string } };

type RpcEvent = {
  type: "event";
  topic: string;
  payload: unknown;
};

function isObject(x: unknown): x is JsonObject {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function getString(x: unknown): string | null {
  return typeof x === "string" && x.trim() ? x.trim() : null;
}

function getNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function send(msg: RpcResponse | RpcEvent) {
  if (typeof process.send === "function") {
    process.send(msg);
  }
}

function replyOk(id: string, result: unknown) {
  send({ id, type: "res", ok: true, result });
}

function replyErr(id: string, err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err));
  send({
    id,
    type: "res",
    ok: false,
    error: {
      message: e.message,
      ...(typeof e.stack === "string" ? { stack: e.stack } : {}),
    },
  });
}

function requireParams(params: unknown): JsonObject {
  if (!isObject(params)) throw new Error("Invalid params.");
  return params;
}

function defaultAssistantPrompt(): string {
  return "How can I help you today?\n\nTell me what you want to learn, and optionally the language (java/python/cpp/sql) and how many problems (1–7).";
}

type Subscription = { threadId: string; unsubscribe: () => void };
const generationSubs = new Map<string, Subscription>();

function makeSubId(): string {
  return crypto.randomUUID();
}

async function handle(method: string, paramsRaw: unknown): Promise<unknown> {
  if (method === "threads.create") {
    const params = requireParams(paramsRaw);
    const learning_mode = (params.learning_mode ?? null) as LearningMode | null;
    const created = createSession(learning_mode ?? undefined);
    const promptText = defaultAssistantPrompt();
    sessionMessageDb.create(crypto.randomUUID(), created.sessionId, "assistant", promptText);
    return {
      threadId: created.sessionId,
      state: created.state,
      learning_mode: created.learning_mode,
      nextQuestion: promptText,
      questionKey: null,
      done: false,
      next_action: "ask",
    };
  }

  if (method === "threads.list") {
    const params = requireParams(paramsRaw);
    const limit = getNumber(params.limit) ?? 20;
    const threads = sessionDb.listSummaries(limit);
    return { threads };
  }

  if (method === "threads.get") {
    const params = requireParams(paramsRaw);
    const threadId = getString(params.threadId);
    if (!threadId) throw new Error("threadId is required.");
    const s = getSession(threadId);
    return {
      threadId: s.id,
      state: s.state,
      learning_mode: s.learning_mode,
      spec: s.spec,
      messages: s.messages,
      collector: s.collector,
      confidence: s.confidence,
      commitments: s.commitments,
      generationOutcomes: s.generationOutcomes,
      intentTrace: s.intentTrace,
    };
  }

  if (method === "threads.postMessage") {
    const params = requireParams(paramsRaw);
    const threadId = getString(params.threadId);
    const message = getString(params.message);
    if (!threadId) throw new Error("threadId is required.");
    if (!message) throw new Error("message is required.");
    return processSessionMessage(threadId, message);
  }

  if (method === "threads.subscribeGeneration") {
    const params = requireParams(paramsRaw);
    const threadId = getString(params.threadId);
    if (!threadId) throw new Error("threadId is required.");

    // Ensure thread exists.
    getSession(threadId);

    const subId = makeSubId();
    const buffered = getGenerationProgressBuffer(threadId);
    const unsubscribe = subscribeGenerationProgress(threadId, (ev: GenerationProgressEvent) => {
      send({ type: "event", topic: "threads.generation", payload: { subId, event: ev } });
    });
    generationSubs.set(subId, { threadId, unsubscribe });

    return { subId, buffered };
  }

  if (method === "threads.unsubscribeGeneration") {
    const params = requireParams(paramsRaw);
    const subId = getString(params.subId);
    if (!subId) throw new Error("subId is required.");
    const sub = generationSubs.get(subId);
    if (sub) {
      try {
        sub.unsubscribe();
      } finally {
        generationSubs.delete(subId);
      }
    }
    return { ok: true };
  }

  if (method === "threads.generate") {
    const params = requireParams(paramsRaw);
    const threadId = getString(params.threadId);
    if (!threadId) throw new Error("threadId is required.");
    const { activityId, problems } = await generateFromSession(threadId);
    return { activityId, problemCount: problems.length };
  }

  if (method === "activities.get") {
    const params = requireParams(paramsRaw);
    const id = getString(params.id);
    if (!id) throw new Error("id is required.");
    const dbActivity = activityDb.findById(id);
    if (!dbActivity) throw new Error("Activity not found.");
    return {
      activity: {
        id: dbActivity.id,
        title: dbActivity.title,
        prompt: dbActivity.prompt || "",
        problems: JSON.parse(dbActivity.problems),
        status: (dbActivity.status as any) ?? "DRAFT",
        timeLimitSeconds: typeof dbActivity.time_limit_seconds === "number" ? dbActivity.time_limit_seconds : null,
        createdAt: dbActivity.created_at,
      },
    };
  }

  if (method === "activities.patch") {
    const params = requireParams(paramsRaw);
    const id = getString(params.id);
    if (!id) throw new Error("id is required.");
    const dbActivity = activityDb.findById(id);
    if (!dbActivity) throw new Error("Activity not found.");
    if ((dbActivity.status ?? "DRAFT") !== "DRAFT") throw new Error("This activity has already been published.");

    const title = typeof params.title === "string" ? params.title.trim() : undefined;
    const timeLimitSeconds =
      typeof params.timeLimitSeconds === "number" && Number.isFinite(params.timeLimitSeconds)
        ? Math.max(0, Math.min(8 * 60 * 60, Math.trunc(params.timeLimitSeconds)))
        : params.timeLimitSeconds === null
          ? null
          : undefined;

    const updated = activityDb.update(id, {
      ...(typeof title === "string" && title ? { title } : {}),
      ...(typeof timeLimitSeconds !== "undefined" ? { time_limit_seconds: timeLimitSeconds } : {}),
    });
    if (!updated) throw new Error("Failed to update activity.");
    return {
      activity: {
        id: updated.id,
        title: updated.title,
        prompt: updated.prompt || "",
        problems: JSON.parse(updated.problems),
        status: (updated.status as any) ?? "DRAFT",
        timeLimitSeconds: typeof updated.time_limit_seconds === "number" ? updated.time_limit_seconds : null,
        createdAt: updated.created_at,
      },
    };
  }

  if (method === "activities.publish") {
    const params = requireParams(paramsRaw);
    const id = getString(params.id);
    if (!id) throw new Error("id is required.");
    const dbActivity = activityDb.findById(id);
    if (!dbActivity) throw new Error("Activity not found.");
    if ((dbActivity.status ?? "DRAFT") === "PUBLISHED") return { ok: true };
    activityDb.update(id, { status: "PUBLISHED" });
    return { ok: true };
  }

  if (method === "activities.aiEdit") {
    const params = requireParams(paramsRaw);
    const id = getString(params.id);
    const problemId = getString(params.problemId);
    const instruction = getString(params.instruction);
    if (!id) throw new Error("id is required.");
    if (!problemId) throw new Error("problemId is required.");
    if (!instruction) throw new Error("instruction is required.");

    const dbActivity = activityDb.findById(id);
    if (!dbActivity) throw new Error("Activity not found.");
    if ((dbActivity.status ?? "DRAFT") !== "DRAFT") throw new Error("This activity has already been published.");

    let problems: any[] = [];
    try {
      const parsedProblems = JSON.parse(dbActivity.problems);
      problems = Array.isArray(parsedProblems) ? parsedProblems : [];
    } catch {
      throw new Error("Failed to load activity problems.");
    }

    const idx = problems.findIndex((p) => p && typeof p === "object" && (p as any).id === problemId);
    if (idx < 0) throw new Error("Problem not found.");

    const updatedProblem = await editDraftProblemWithAi({
      existing: problems[idx],
      instruction,
    });
    const nextProblems = [...problems];
    nextProblems[idx] = updatedProblem;

    const updated = activityDb.update(id, { problems: JSON.stringify(nextProblems) });
    if (!updated) throw new Error("Failed to update activity.");

    return {
      activity: {
        id: updated.id,
        title: updated.title,
        prompt: updated.prompt || "",
        problems: JSON.parse(updated.problems),
        status: (updated.status as any) ?? "DRAFT",
        timeLimitSeconds: typeof updated.time_limit_seconds === "number" ? updated.time_limit_seconds : null,
        createdAt: updated.created_at,
      },
    };
  }

  if (method === "judge.run") {
    const params = requireParams(paramsRaw);
    const { code, language, files, mainClass, stdin } = params;

    const langParsed = ActivityLanguageSchema.safeParse(language);
    if (!langParsed.success) throw new Error("Invalid language.");
    const lang = langParsed.data;
    if (!isLanguageSupportedForExecution(lang)) throw new Error(`Language "${lang}" is not supported for /run yet.`);
    const profile = getLanguageProfile(lang);
    if (!profile.executionAdapter) throw new Error(`No execution adapter configured for "${lang}".`);

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
      if (typeof stdin !== "string") throw new Error("stdin must be a string.");
      if (stdin.length > maxStdinLength) throw new Error(`stdin exceeds maximum length of ${maxStdinLength} characters.`);
      safeStdin = stdin;
    }

    if (files && typeof files === "object") {
      const entries = Object.entries(files as Record<string, unknown>);
      if (entries.length === 0) throw new Error("files must be a non-empty object.");
      if (entries.length > maxFileCount) throw new Error(`Too many files. Max is ${maxFileCount}.`);

      let totalLen = safeStdin?.length ?? 0;
      const safeFiles: Record<string, string> = {};
      for (const [filename, source] of entries) {
        if (typeof filename !== "string" || !filenamePattern.test(filename)) {
          throw new Error(`Invalid filename "${String(filename)}".`);
        }
        if (typeof source !== "string" || !source.trim()) {
          throw new Error(`File "${filename}" must be a non-empty string.`);
        }
        totalLen += source.length;
        if (totalLen > maxTotalCodeLength) {
          throw new Error(`Total code exceeds maximum length of ${maxTotalCodeLength} characters.`);
        }
        safeFiles[filename] = source;
      }

      if (lang === "python") {
        const hasMain = entries.some(([filename]) => filename === "main.py");
        if (!hasMain) throw new Error('Python /run requires a "main.py" file.');
      }
      if (lang === "cpp") {
        const hasMain = entries.some(([filename]) => filename === "main.cpp");
        if (!hasMain) throw new Error('C++ /run requires a "main.cpp" file.');
      }
      if (lang === "sql") {
        throw new Error('SQL does not support /run yet. Use /submit (Run tests).');
      }

      const execReq: {
        kind: "files";
        files: Record<string, string>;
        mainClass?: string;
        stdin?: string;
      } = { kind: "files", files: safeFiles };
      if (typeof mainClass === "string" && mainClass.trim()) execReq.mainClass = mainClass.trim();
      if (typeof safeStdin === "string") execReq.stdin = safeStdin;

      const result = await profile.executionAdapter.run(execReq);
      return { stdout: result.stdout, stderr: result.stderr };
    }

    if (typeof code !== "string" || !code.trim()) {
      throw new Error("Provide either code (string) or files (object).");
    }
    const total = code.length + (safeStdin?.length ?? 0);
    if (total > maxTotalCodeLength) throw new Error(`Code exceeds maximum length of ${maxTotalCodeLength} characters.`);

    const execReq: { kind: "code"; code: string; stdin?: string } = { kind: "code", code };
    if (typeof safeStdin === "string") execReq.stdin = safeStdin;
    const result = await profile.executionAdapter.run(execReq);
    return { stdout: result.stdout, stderr: result.stderr };
  }

  if (method === "judge.submit") {
    const params = requireParams(paramsRaw);
    const { code, testSuite, activityId, problemId, files, language } = params;

    if (typeof testSuite !== "string" || !testSuite.trim()) {
      throw new Error("testSuite is required for graded execution. Use /run for code-only execution.");
    }

    const langParsed = ActivityLanguageSchema.safeParse(language ?? "java");
    if (!langParsed.success) throw new Error("Invalid language.");
    const lang = langParsed.data;
    if (!isLanguageSupportedForJudge(lang)) throw new Error(`Language "${lang}" is not supported for /submit yet.`);
    const profile = getLanguageProfile(lang);
    if (!profile.judgeAdapter) throw new Error(`No judge adapter configured for "${lang}".`);

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

    let result: any;
    let codeForPersistence: string | null = null;

    if (files && typeof files === "object") {
      const entries = Object.entries(files as Record<string, unknown>);
      if (entries.length === 0) throw new Error("files must be a non-empty object.");
      if (entries.length > maxFileCount) throw new Error(`Too many files. Max is ${maxFileCount}.`);

      let totalLen = testSuite.length;
      const safeFiles: Record<string, string> = {};
      for (const [filename, source] of entries) {
        if (typeof filename !== "string" || !filenamePattern.test(filename)) {
          throw new Error(`Invalid filename "${String(filename)}".`);
        }
        if (typeof source !== "string" || !source.trim()) {
          throw new Error(`File "${filename}" must be a non-empty string.`);
        }
        totalLen += source.length;
        if (totalLen > maxTotalCodeLength) throw new Error(`Total code exceeds maximum length of ${maxTotalCodeLength} characters.`);
        safeFiles[filename] = source;
      }

      if (lang === "python") {
        if (Object.prototype.hasOwnProperty.call(safeFiles, "test_solution.py")) {
          throw new Error('files must not include "test_solution.py".');
        }
        if (!Object.prototype.hasOwnProperty.call(safeFiles, "solution.py")) {
          throw new Error('Python /submit requires a "solution.py" file.');
        }
      }
      if (lang === "cpp") {
        if (Object.prototype.hasOwnProperty.call(safeFiles, "test.cpp")) {
          throw new Error('files must not include "test.cpp".');
        }
        if (!Object.prototype.hasOwnProperty.call(safeFiles, "solution.cpp")) {
          throw new Error('C++ /submit requires a "solution.cpp" file.');
        }
        const cppSources = Object.keys(safeFiles).filter((f) => f.endsWith(".cpp") && f !== "solution.cpp");
        if (cppSources.length > 0) {
          throw new Error(`C++ /submit supports "solution.cpp" plus optional headers only. Remove: ${cppSources.join(", ")}`);
        }
      }
      if (lang === "sql") {
        if (!Object.prototype.hasOwnProperty.call(safeFiles, "solution.sql")) {
          throw new Error('SQL /submit requires a "solution.sql" file.');
        }
        const extras = Object.keys(safeFiles).filter((f) => f !== "solution.sql");
        if (extras.length > 0) {
          throw new Error(`SQL /submit supports only solution.sql. Remove: ${extras.join(", ")}`);
        }
      }

      result = await profile.judgeAdapter.judge({ kind: "files", files: safeFiles, testSuite });
      codeForPersistence = JSON.stringify(safeFiles);
    } else {
      if (typeof code !== "string" || !code.trim()) {
        throw new Error("code is required non-empty string.");
      }
      if (code.length + testSuite.length > maxTotalCodeLength) {
        throw new Error(`Total code exceeds maximum length of ${maxTotalCodeLength} characters.`);
      }
      result = await profile.judgeAdapter.judge({ kind: "code", code, testSuite });
      codeForPersistence = code;
    }

    // Persist submissions locally (workspace-scoped DB file).
    if (typeof activityId === "string" && typeof problemId === "string") {
      const dbActivity = activityDb.findById(activityId);
      if (dbActivity) {
        const totalTests = result.passedTests.length + result.failedTests.length;
        submissionDb.create(
          activityId,
          problemId,
          codeForPersistence ?? "",
          result.success,
          result.passedTests.length,
          totalTests,
          result.executionTimeMs
        );
      }
    }

    return result;
  }

  throw new Error(`Unknown method: ${method}`);
}

function onMessage(raw: unknown) {
  if (!isObject(raw)) return;
  const msg = raw as Partial<RpcRequest>;
  if (msg.type !== "req") return;
  if (typeof msg.id !== "string" || !msg.id) return;
  if (typeof msg.method !== "string" || !msg.method) return;

  Promise.resolve()
    .then(() => handle(msg.method!, msg.params))
    .then((result) => replyOk(msg.id!, result))
    .catch((err) => replyErr(msg.id!, err));
}

function shutdown() {
  for (const [subId, sub] of generationSubs.entries()) {
    try {
      sub.unsubscribe();
    } catch {
      // ignore
    }
    generationSubs.delete(subId);
  }
}

initializeDatabase();

process.on("message", onMessage);
process.on("disconnect", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("exit", shutdown);
