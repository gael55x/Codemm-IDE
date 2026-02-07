"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Editor from "@monaco-editor/react";
import {
  CPP_FILENAME_PATTERN,
  JAVA_FILENAME_PATTERN,
  PYTHON_FILENAME_PATTERN,
  buildCppMainTemplate,
  buildMainJavaTemplate,
  buildPythonMainTemplate,
  countTests,
  hasCppMainMethod,
  hasJavaMainMethod,
  inferJavaClassName,
  type FileRole,
  type LanguageId,
} from "@/lib/languages";

type Problem = {
  language?: LanguageId;
  id: string;
  title: string;
  description: string;
  // v1.0 uses starter_code, legacy uses classSkeleton
  starter_code?: string;
  classSkeleton?: string;
  // v1.0 uses test_suite, legacy uses testSuite
  test_suite?: string;
  testSuite?: string;
  workspace?: {
    files: { path: string; role: FileRole; content: string }[];
    entrypoint?: string;
  };
  constraints: string;
  // v1.0 uses sample_inputs, legacy uses sampleInputs
  sample_inputs?: string[];
  sampleInputs?: string[];
  sample_outputs?: string[];
  sampleOutputs?: string[];
  difficulty?: string;
  topic_tag?: string;
  pedagogy?: {
    scaffold_level?: number;
    learning_goal?: string;
    hints_enabled?: boolean;
  };
};

type Activity = {
  id: string;
  title: string;
  prompt: string;
  problems: Problem[];
  createdAt: string;
  status?: "DRAFT" | "PUBLISHED";
  timeLimitSeconds?: number | null;
};

type JudgeResult = {
  success: boolean;
  passedTests: string[];
  failedTests: string[];
  stdout: string;
  stderr: string;
  executionTimeMs?: number;
  exitCode?: number;
  timedOut?: boolean;
  // Optional structured per-test details (best-effort; may be absent).
  testCaseDetails?: Array<{
    name: string;
    passed: boolean;
    input?: string;
    expectedOutput?: string;
    actualOutput?: string;
    message?: string;
  }>;
};

type RunResult = {
  stdout: string;
  stderr: string;
};

type CodeFiles = Record<string, string>;

function requireActivitiesApi() {
  const api = (window as any)?.codemm?.activities;
  if (!api) throw new Error("IDE bridge unavailable. Launch this UI inside Codemm-IDE.");
  return api;
}

function requireJudgeApi() {
  const api = (window as any)?.codemm?.judge;
  if (!api) throw new Error("IDE bridge unavailable. Launch this UI inside Codemm-IDE.");
  return api;
}

function getProblemLanguage(p: Problem | null | undefined): LanguageId {
  if (p?.language === "python") return "python";
  if (p?.language === "cpp") return "cpp";
  if (p?.language === "sql") return "sql";
  return "java";
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function countStudentTodoMarkersInText(text: string): number {
  if (!text) return 0;
  return (text.match(/BEGIN STUDENT TODO/g) ?? []).length;
}

function countStudentTodoMarkers(problem: Problem): number {
  if (problem.workspace?.files?.length) {
    return problem.workspace.files.reduce((sum, f) => sum + countStudentTodoMarkersInText(f.content), 0);
  }
  return countStudentTodoMarkersInText(problem.starter_code ?? problem.classSkeleton ?? "");
}

function parseJUnitTree(stdout: string): { passed: string[]; failed: string[] } {
  const clean = stripAnsi(stdout);
  const passed: string[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();

  for (const line of clean.split(/\r?\n/)) {
    // Example:
    // |   +-- testFoo() [OK]
    // |   +-- testBar() [X] expected: <...> but was: <...>
    const m = line.match(/([A-Za-z_][A-Za-z0-9_]*)\(\)\s+\[(OK|X)\]/);
    if (!m) continue;
    const name = m[1]!;
    const status = m[2]!;
    const key = `${name}:${status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (status === "OK") passed.push(name);
    if (status === "X") failed.push(name);
  }

  return { passed, failed };
}

function parseExpectedActual(message: string): { expected: string; actual: string } | null {
  // Common JUnit assertion format for assertEquals:
  // "expected: <0> but was: <-5>"
  const m = message.match(/expected:\s*<([\s\S]*?)>\s*but\s+was:\s*<([\s\S]*?)>/i);
  if (!m) return null;
  return { expected: m[1] ?? "", actual: m[2] ?? "" };
}

function parseJUnitFailures(stdout: string): Record<string, { message: string; location?: string }> {
  const clean = stripAnsi(stdout);
  const failures: Record<string, { message: string; location?: string }> = {};

  // Looks for:
  // JUnit Jupiter:PersonTest:testNegativeAgeSetsZero()
  //   ...
  //   => org.opentest4j.AssertionFailedError: expected: <0> but was: <-5>
  //      ...
  //      PersonTest.testNegativeAgeSetsZero(PersonTest.java:23)
  const re =
    /JUnit Jupiter:[^:\n]+:([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\n[\s\S]*?=>\s*([^\n]+)(?:[\s\S]*?\(([A-Za-z0-9_]+\.java:\d+)\))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean)) !== null) {
    const testName = match[1]!;
    const message = match[2]!.trim();
    const location = match[3]?.trim();
    failures[testName] = { message, location };
  }

  return failures;
}

function normalizeDiagnostics(text: string): string {
  const clean = stripAnsi(text);
  const lines = clean.split(/\r?\n/);

  // Hide docker's deprecation warning block; it is not actionable for learners.
  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("WARNING: Delegated to the 'execute' command.")) {
      // Skip this line + the next 2 lines which are part of the warning block.
      i += 2;
      continue;
    }
    filtered.push(line);
  }

  return filtered.join("\n").trim();
}

type SqlSuite = {
  schema_sql: string;
  cases: Array<{
    name: string;
    seed_sql: string;
    expected: { columns: string[]; rows: Array<Array<string | number | null>> };
    order_matters?: boolean;
  }>;
};

function tryParseSqlSuite(testSuite: string): SqlSuite | null {
  if (!testSuite.trim()) return null;
  try {
    const parsed = JSON.parse(testSuite);
    if (!parsed || typeof parsed !== "object") return null;
    const schema_sql = typeof (parsed as any).schema_sql === "string" ? (parsed as any).schema_sql : "";
    const cases = Array.isArray((parsed as any).cases) ? (parsed as any).cases : null;
    if (!schema_sql || !cases) return null;
    const normalized: SqlSuite["cases"] = [];
    for (const c of cases) {
      if (!c || typeof c !== "object") continue;
      const name = typeof (c as any).name === "string" ? (c as any).name : "";
      const seed_sql = typeof (c as any).seed_sql === "string" ? (c as any).seed_sql : "";
      const expected = (c as any).expected;
      if (!name || !seed_sql || !expected || typeof expected !== "object") continue;
      const columns = Array.isArray(expected.columns) ? expected.columns : [];
      const rows = Array.isArray(expected.rows) ? expected.rows : [];
      if (columns.length === 0) continue;
      normalized.push({
        name,
        seed_sql,
        expected: { columns, rows },
        ...(typeof (c as any).order_matters === "boolean" ? { order_matters: (c as any).order_matters } : {}),
      });
    }
    return { schema_sql, cases: normalized };
  } catch {
    return null;
  }
}

function formatSqlExpected(columns: string[], rows: Array<Array<string | number | null>>): string {
  const header = columns.join("\t");
  const body = rows.map((r) => r.map((v) => (v == null ? "NULL" : String(v))).join("\t")).join("\n");
  return [header, body].filter(Boolean).join("\n");
}

function parseSqlMismatchBlocks(stderr: string): Array<{
  actual?: string;
  message: string;
}> {
  const text = normalizeDiagnostics(stderr);
  if (!text) return [];

  const blocks = text
    .split(/Expected columns\/rows did not match\.\s*/g)
    .map((b) => b.trim())
    .filter(Boolean);

  const parsePyList = (s: string | undefined): any => {
    if (!s) return undefined;
    const jsonish = s
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/'/g, '"');
    try {
      return JSON.parse(jsonish);
    } catch {
      return undefined;
    }
  };

  const out: Array<{ actual?: string; message: string }> = [];
  for (const b of blocks) {
    const actualColumnsRaw = b.match(/Actual columns:\s*([^\n]+)/)?.[1];
    const actualRowsRaw = b.match(/Actual rows:\s*([^\n]+)/)?.[1];
    const actualColumns = parsePyList(actualColumnsRaw);
    const actualRows = parsePyList(actualRowsRaw);
    const actual =
      Array.isArray(actualColumns) && Array.isArray(actualRows)
        ? formatSqlExpected(actualColumns, actualRows)
        : undefined;
    out.push({ actual, message: b });
  }
  return out;
}

function sortTestCaseNames(names: string[]): string[] {
  const uniq = Array.from(new Set(names)).filter(Boolean);
  const score = (s: string) => {
    const m = s.match(/\btest_case_(\d+)\b/i);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  return uniq.sort((a, b) => {
    const na = score(a);
    const nb = score(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

type PersistedTimerStateV1 = {
  v: 1;
  mode: "countup" | "countdown";
  limitSeconds: number | null;
  baseSeconds: number;
  startedAtMs: number | null;
};

export default function ActivityPage() {
  const params = useParams<{ id: string }>();
  const activityId = params.id;
  const router = useRouter();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(
    null
  );
  const [files, setFiles] = useState<CodeFiles>({
    "Solution.java": "public class Solution {\n}\n",
    "Main.java": buildMainJavaTemplate("Solution"),
  });
  const [fileRoles, setFileRoles] = useState<Record<string, FileRole>>({
    "Solution.java": "support",
    "Main.java": "entry",
  });
  const [activeFilename, setActiveFilename] = useState<string>("Solution.java");
  const [entrypointClass, setEntrypointClass] = useState<string>("Main");
  const [timeLimitSeconds, setTimeLimitSeconds] = useState<number | null>(null);
  const [timerMode, setTimerMode] = useState<"countup" | "countdown">("countup");
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerBaseSeconds, setTimerBaseSeconds] = useState(0);
  const [timerStartedAtMs, setTimerStartedAtMs] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [result, setResult] = useState<JudgeResult | RunResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const todoDecorationsRef = useRef<string[]>([]);

  function updateTodoDecorations(nextCode: string) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const lines = String(nextCode ?? "").split("\n");
    const ranges: Array<{ start: number; end: number }> = [];
    let open: number | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.includes("BEGIN STUDENT TODO")) open = i + 1;
      if (line.includes("END STUDENT TODO") && open != null) {
        const end = i + 1;
        if (end >= open) ranges.push({ start: open, end });
        open = null;
      }
    }

    const decorations = ranges.map((r) => ({
      range: new monaco.Range(r.start, 1, r.end, 1),
      options: {
        isWholeLine: true,
        className: "codem-student-todo-bg",
        linesDecorationsClassName: "codem-student-todo-gutter",
      },
    }));

    todoDecorationsRef.current = editor.deltaDecorations(todoDecorationsRef.current, decorations);
  }

  function loadProblemIntoWorkspace(problem: Problem) {
    const lang = getProblemLanguage(problem);
    const starterCode =
      problem.starter_code ||
      problem.classSkeleton ||
      (lang === "python"
        ? "def solve(x):\n    # TODO: implement\n    raise NotImplementedError\n"
        : lang === "cpp"
        ? "#include <bits/stdc++.h>\n\n// Implement solve(...) below.\nauto solve(auto x) { (void)x; return 0; }\n"
        : lang === "sql"
        ? "-- Write a single SELECT query.\nSELECT 1;\n"
        : "public class Solution {\n}\n");

    if (problem.workspace && Array.isArray(problem.workspace.files) && problem.workspace.files.length > 0) {
      const nextFiles: CodeFiles = {};
      const nextRoles: Record<string, FileRole> = {};
      for (const f of problem.workspace.files) {
        nextFiles[f.path] = f.content;
        nextRoles[f.path] = f.role;
      }
      setFiles(nextFiles);
      setFileRoles(nextRoles);
      const entryClass = problem.workspace.entrypoint ?? "Main";
      setEntrypointClass(entryClass);
      const firstEditable =
        problem.workspace.files.find((f) => f.role !== "readonly")?.path ??
        problem.workspace.files[0]!.path;
      setActiveFilename(firstEditable);
      return;
    }

    if (lang === "python") {
      setFiles({
        "solution.py": starterCode,
        "main.py": buildPythonMainTemplate(),
      });
      setFileRoles({
        "solution.py": "support",
        "main.py": "entry",
      });
      setEntrypointClass("main.py");
      setActiveFilename("solution.py");
      return;
    }

    if (lang === "cpp") {
      setFiles({
        "solution.cpp": starterCode,
        "main.cpp": buildCppMainTemplate(),
      });
      setFileRoles({
        "solution.cpp": "support",
        "main.cpp": "entry",
      });
      setEntrypointClass("main.cpp");
      setActiveFilename("solution.cpp");
      return;
    }

    if (lang === "sql") {
      setFiles({
        "solution.sql": starterCode,
      });
      setFileRoles({
        "solution.sql": "support",
      });
      setEntrypointClass("solution.sql");
      setActiveFilename("solution.sql");
      return;
    }

    const primaryClassName = inferJavaClassName(starterCode, "Solution");
    const primaryFilename = `${primaryClassName}.java`;
    setFiles({
      [primaryFilename]: starterCode,
      "Main.java": buildMainJavaTemplate(primaryClassName),
    });
    setFileRoles({
      [primaryFilename]: "support",
      "Main.java": "entry",
    });
    setEntrypointClass("Main");
    setActiveFilename(primaryFilename);
  }

  function timerStorageKey(problemId: string): string {
    return `codem-activity-timer:v1:${activityId}:${problemId}`;
  }

  function computeTimerSeconds(nowMs: number): number {
    if (!isTimerRunning || timerStartedAtMs == null) return timerBaseSeconds;
    const elapsed = Math.max(0, Math.floor((nowMs - timerStartedAtMs) / 1000));
    return timerMode === "countdown"
      ? Math.max(0, timerBaseSeconds - elapsed)
      : timerBaseSeconds + elapsed;
  }

  function persistTimer(problemId: string, next: PersistedTimerStateV1) {
    try {
      localStorage.setItem(timerStorageKey(problemId), JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function loadOrStartTimer(problemId: string, limitSeconds: number | null, mode: "countup" | "countdown") {
    const now = Date.now();
    const key = timerStorageKey(problemId);

    let stored: PersistedTimerStateV1 | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = null;
    }

    const valid =
      stored &&
      stored.v === 1 &&
      (stored.mode === "countup" || stored.mode === "countdown") &&
      (typeof stored.baseSeconds === "number" && Number.isFinite(stored.baseSeconds)) &&
      (stored.startedAtMs == null || (typeof stored.startedAtMs === "number" && Number.isFinite(stored.startedAtMs))) &&
      (stored.limitSeconds == null || (typeof stored.limitSeconds === "number" && Number.isFinite(stored.limitSeconds))) &&
      stored.mode === mode &&
      (stored.limitSeconds ?? null) === (limitSeconds ?? null);

    const nextBaseSeconds =
      valid && typeof stored!.baseSeconds === "number"
        ? Math.max(0, Math.trunc(stored!.baseSeconds))
        : mode === "countdown" && typeof limitSeconds === "number" && limitSeconds > 0
          ? limitSeconds
          : 0;

    const nextStartedAtMs =
      valid && typeof stored!.startedAtMs === "number" ? Math.trunc(stored!.startedAtMs) : now;

    setTimerMode(mode);
    setTimeLimitSeconds(limitSeconds);
    setTimerBaseSeconds(nextBaseSeconds);
    setTimerStartedAtMs(nextStartedAtMs);
    setIsTimerRunning(true);

    // Sync display immediately and clamp countdown-at-zero.
    const computed = (() => {
      const elapsed = Math.max(0, Math.floor((now - nextStartedAtMs) / 1000));
      return mode === "countdown" ? Math.max(0, nextBaseSeconds - elapsed) : nextBaseSeconds + elapsed;
    })();
    setTimerSeconds(computed);

    if (mode === "countdown" && computed <= 0) {
      setIsTimerRunning(false);
      setTimerBaseSeconds(0);
      setTimerStartedAtMs(null);
      persistTimer(problemId, { v: 1, mode, limitSeconds, baseSeconds: 0, startedAtMs: null });
      return;
    }

    persistTimer(problemId, { v: 1, mode, limitSeconds, baseSeconds: nextBaseSeconds, startedAtMs: nextStartedAtMs });
  }

  useEffect(() => {

    async function load() {
      try {
        setLoadError(null);
        const data = await requireActivitiesApi().get({ id: activityId });
        const act = data?.activity as Activity | undefined;
        if (!act) {
          setLoadError("Activity not found.");
          return;
        }

        setActivity(act);
          if (act.problems.length > 0) {
            const first = act.problems[0];
            setSelectedProblemId(first.id);
            loadProblemIntoWorkspace(first);
          }

          const limit = typeof act.timeLimitSeconds === "number" ? act.timeLimitSeconds : null;
          const mode: "countup" | "countdown" = typeof limit === "number" && limit > 0 ? "countdown" : "countup";
          if (act.problems.length > 0) {
            loadOrStartTimer(act.problems[0]!.id, limit, mode);
          } else {
            setTimeLimitSeconds(limit);
            setTimerMode(mode);
            setTimerBaseSeconds(0);
            setTimerSeconds(0);
            setIsTimerRunning(false);
          }
      } catch (e) {
        console.error(e);
        setLoadError("Failed to load activity.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activityId]);

  useEffect(() => {
    if (!isTimerRunning) return;
    const tick = () => {
      const now = Date.now();
      const next = computeTimerSeconds(now);
      setTimerSeconds(next);
      if (timerMode === "countdown" && next <= 0) {
        setIsTimerRunning(false);
        setTimerBaseSeconds(0);
        setTimerStartedAtMs(null);
        if (selectedProblemId) {
          persistTimer(selectedProblemId, {
            v: 1,
            mode: "countdown",
            limitSeconds: timeLimitSeconds ?? null,
            baseSeconds: 0,
            startedAtMs: null,
          });
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [isTimerRunning, timerMode, timerStartedAtMs, timerBaseSeconds, selectedProblemId, timeLimitSeconds]);

  const selectedProblem = activity?.problems.find(
    (p) => p.id === selectedProblemId
  );
  const isGuidedActivity = Boolean(
    activity?.problems.some((p) => p.pedagogy && typeof p.pedagogy.scaffold_level === "number")
  );
  const selectedLanguage = getProblemLanguage(selectedProblem);

  const testSuite = selectedProblem?.test_suite || selectedProblem?.testSuite || "";
  const testCount = countTests(selectedLanguage, testSuite);
  const activeCode = files[activeFilename] ?? "";
  const entryFile =
    selectedLanguage === "python"
      ? "main.py"
      : selectedLanguage === "cpp"
      ? "main.cpp"
      : selectedLanguage === "sql"
      ? "solution.sql"
      : Object.entries(fileRoles).find(([, role]) => role === "entry")?.[0] ?? "Main.java";
  const entrySource = files[entryFile] ?? "";
  const canRunMain =
    selectedLanguage === "python"
      ? true
      : selectedLanguage === "cpp"
      ? hasCppMainMethod(entrySource)
      : selectedLanguage === "sql"
      ? false
      : hasJavaMainMethod(entrySource);
  const isActiveReadonly = fileRoles[activeFilename] === "readonly";

  useEffect(() => {
    updateTodoDecorations(activeCode);
  }, [activeFilename, activeCode]);

  const junitTree =
    result && "success" in result ? parseJUnitTree(result.stdout ?? "") : { passed: [], failed: [] };
  const junitFailures =
    result && "success" in result ? parseJUnitFailures(result.stdout ?? "") : {};
  const passedTests =
    result && "success" in result && result.passedTests.length > 0 ? result.passedTests : junitTree.passed;
  const failedTests =
    result && "success" in result && result.failedTests.length > 0 ? result.failedTests : junitTree.failed;
  const judgeTimedOut =
    Boolean(result && "success" in result && (result as JudgeResult).timedOut);
  const judgeExitCode =
    result && "success" in result && typeof (result as JudgeResult).exitCode === "number"
      ? (result as JudgeResult).exitCode
      : undefined;

  async function handleRun() {
    if (!selectedProblem) return;
    if (selectedLanguage === "sql") {
      setResult({
        stdout: "",
        stderr: 'SQL activities are graded via "Run tests".',
      });
      return;
    }
    if (!canRunMain && selectedLanguage !== "python") {
      const mainSig =
        selectedLanguage === "cpp"
          ? "int main(...)"
          : "`public static void main(String[] args)`";
      setResult({
        stdout: "",
        stderr:
          `No ${mainSig} detected in ${entryFile}.\n\nThis activity is graded by unit tests. Use "Run tests" to see pass/fail, or add a main() entrypoint if you want to print/debug locally.`,
      });
      return;
    }
    setRunning(true);
    try {
      const sampleIns = selectedProblem.sample_inputs || selectedProblem.sampleInputs || [];
      const stdin = sampleIns.length > 0 ? String(sampleIns[0]) : undefined;
      const data = await requireJudgeApi().run({
          files,
          ...(selectedLanguage === "java" ? { mainClass: entrypointClass || "Main" } : {}),
          ...(typeof stdin === "string" ? { stdin } : {}),
          language: selectedLanguage,
      });

      if (!data || typeof data !== "object") {
        setResult({ stdout: "", stderr: "Failed to run code (invalid response)." });
        return;
      }

      const runResult: RunResult = {
        stdout: typeof data.stdout === "string" ? data.stdout : "",
        stderr:
          typeof data.stderr === "string"
            ? data.stderr
            : typeof data.error === "string"
            ? data.error
            : "",
      };

      setResult(runResult);
    } catch (e) {
      console.error(e);
      setResult({
        stdout: "",
        stderr: "Failed to run code. Please try again.",
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleRunTests() {
    if (!selectedProblem) return;
    setSubmitting(true);
    try {
      const testSuite = selectedProblem.test_suite || selectedProblem.testSuite || "";
      const filesForTests = Object.fromEntries(
        Object.entries(files).filter(([filename]) => {
          if (fileRoles[filename] === "readonly") return false;
          if (selectedLanguage !== "cpp") return true;
          if (filename.endsWith(".cpp")) return filename === "solution.cpp";
          return true;
        })
      );

      const data = await requireJudgeApi().submit({
        files: filesForTests,
        testSuite,
        activityId,
        problemId: selectedProblem.id,
        language: selectedLanguage,
      });

      const safeResult: JudgeResult = {
        success: Boolean(data.success),
        passedTests: Array.isArray(data.passedTests) ? data.passedTests : [],
        failedTests: Array.isArray(data.failedTests) ? data.failedTests : [],
        stdout: typeof data.stdout === "string" ? data.stdout : "",
        stderr:
          typeof data.stderr === "string"
            ? data.stderr
            : typeof data.error === "string"
            ? data.error
            : "",
        executionTimeMs:
          typeof data.executionTimeMs === "number" ? data.executionTimeMs : 0,
        exitCode: typeof data.exitCode === "number" ? data.exitCode : undefined,
        timedOut: typeof data.timedOut === "boolean" ? data.timedOut : undefined,
        testCaseDetails: Array.isArray(data.testCaseDetails) ? data.testCaseDetails : undefined,
      };

      setResult(safeResult);
      setIsTimerRunning(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  function formatTime(totalSeconds: number) {
    const m = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (totalSeconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function handleAddFile() {
    const raw = window.prompt(
      selectedLanguage === "python"
        ? 'New file name (e.g., "utils.py")'
        : selectedLanguage === "cpp"
        ? 'New file name (e.g., "helper.hpp" or "helper.cpp")'
        : 'New file name (e.g., "Helper.java")'
    );
    if (!raw) return;
    const name = raw.trim();
    const pattern =
      selectedLanguage === "python"
        ? PYTHON_FILENAME_PATTERN
        : selectedLanguage === "cpp"
        ? CPP_FILENAME_PATTERN
        : JAVA_FILENAME_PATTERN;
    if (!pattern.test(name)) {
      setResult({
        stdout: "",
        stderr:
          selectedLanguage === "python"
            ? 'Invalid filename. Use something like "utils.py" (letters/numbers/underscore, must end with .py).'
            : selectedLanguage === "cpp"
            ? 'Invalid filename. Use something like "helper.hpp" or "helper.cpp" (letters/numbers/underscore, must end with .hpp/.h/.cpp).'
            : 'Invalid filename. Use something like "Helper.java" (letters/numbers/underscore, must end with .java).',
      });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(files, name)) {
      setActiveFilename(name);
      return;
    }
    const className = name.replace(/\.[A-Za-z0-9_]+$/i, "");
    const skeleton =
      selectedLanguage === "python"
        ? `# ${className}.py\n\n`
        : selectedLanguage === "cpp"
        ? name.endsWith(".cpp")
          ? `#include <bits/stdc++.h>\n\n`
          : `#pragma once\n\n`
        : `public class ${className} {\n\n}\n`;
    setFiles((prev) => ({ ...prev, [name]: skeleton }));
    setFileRoles((prev) => ({ ...prev, [name]: "support" }));
    setActiveFilename(name);
    setResult(null);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-900">
        <div className="rounded-lg bg-white px-4 py-3 text-sm shadow">
          Loading activity...
        </div>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-900">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow">
          <div className="text-sm font-semibold text-slate-900">Couldn’t open this activity</div>
          <div className="mt-1 text-sm text-slate-600">{loadError ?? "Activity not found."}</div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => (window.location.href = "/")}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <style jsx global>{`
        .codem-student-todo-bg {
          background: rgba(250, 204, 21, 0.12);
        }
        .codem-student-todo-gutter {
          border-left: 3px solid rgba(250, 204, 21, 0.9);
        }
      `}</style>
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6">
        {/* Header */}
        <header className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Activity
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              {activity.title}
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {isGuidedActivity ? "Guided" : "Practice"} activity with {activity.problems.length} problems.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.href = "/"}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Home
            </button>
            {activity.status === "DRAFT" && (
              <button
                onClick={() => router.push(`/activity/${activityId}/review`)}
                className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                Draft • Edit
              </button>
            )}
            <div className="rounded-full bg-slate-100 px-4 py-1 text-xs font-medium text-slate-700">
              {timerMode === "countdown" ? "Left" : "Time"}&nbsp;{formatTime(timerSeconds)}
            </div>
          </div>
        </header>

        {/* Main layout */}
        <main className="grid flex-1 gap-4 md:grid-cols-[minmax(220px,1.1fr)_minmax(0,3.2fr)_minmax(220px,1.3fr)]">
          {/* Left: problems + description */}
          <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Problems
            </h2>
            <div className="flex flex-col gap-2">
              {activity.problems.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedProblemId(p.id);
                    loadProblemIntoWorkspace(p);
                    setResult(null);
                    setShowTests(false);
                    const limit = typeof timeLimitSeconds === "number" ? timeLimitSeconds : null;
                    const mode: "countup" | "countdown" = typeof limit === "number" && limit > 0 ? "countdown" : "countup";
                    loadOrStartTimer(p.id, limit, mode);
                  }}
                  className={`flex flex-col rounded-xl border px-3 py-2 text-left text-sm transition ${
                    selectedProblemId === p.id
                      ? "border-blue-500 bg-white shadow-sm"
                      : "border-transparent bg-white hover:border-slate-200 hover:shadow-sm"
                  }`}
                >
                  <span className="font-medium text-slate-900">
                    {p.title}
                  </span>
                  <span className="line-clamp-2 text-xs text-slate-500">
                    {p.description}
                  </span>
                  {p.pedagogy && typeof p.pedagogy.scaffold_level === "number" && (
                    <span className="mt-1 text-[11px] font-medium text-slate-600">
                      Guided • Scaffold {p.pedagogy.scaffold_level}%
                    </span>
                  )}
                  <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {(p.language ?? "java").toUpperCase()}
                  </span>
                </button>
              ))}
            </div>

            {selectedProblem && (
              <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-800">
                <h3 className="text-sm font-semibold text-slate-900">
                  Description
                </h3>
                {selectedProblem.pedagogy && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {typeof selectedProblem.pedagogy.learning_goal === "string" &&
                        selectedProblem.pedagogy.learning_goal.trim() && (
                          <span>
                            <span className="font-semibold text-slate-800">Learning goal:</span>{" "}
                            {selectedProblem.pedagogy.learning_goal.trim()}
                          </span>
                        )}
                      {typeof selectedProblem.pedagogy.scaffold_level === "number" && (
                        <span>
                          <span className="font-semibold text-slate-800">Scaffold:</span>{" "}
                          {selectedProblem.pedagogy.scaffold_level}%
                        </span>
                      )}
                      <span>
                        <span className="font-semibold text-slate-800">TODO regions:</span>{" "}
                        {countStudentTodoMarkers(selectedProblem)}
                      </span>
                    </div>
                  </div>
                )}
                <p className="whitespace-pre-line text-xs text-slate-700">
                  {selectedProblem.description}
                </p>
                {selectedProblem.constraints && (
                  <>
                    <h4 className="pt-2 text-xs font-semibold text-slate-900">
                      Constraints
                    </h4>
                    <p className="text-xs text-slate-700">
                      {selectedProblem.constraints}
                    </p>
                  </>
                )}
                {(() => {
                  const sampleIns = selectedProblem.sample_inputs || selectedProblem.sampleInputs || [];
                  const sampleOuts = selectedProblem.sample_outputs || selectedProblem.sampleOutputs || [];
                  if (sampleIns.length > 0 || sampleOuts.length > 0) {
                    return (
                      <div className="grid gap-2 pt-2 text-xs sm:grid-cols-2">
                        {sampleIns.length > 0 && (
                          <div>
                            <h4 className="mb-1 font-semibold text-slate-900">
                              Sample Input
                            </h4>
                            <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-800">
                              {sampleIns.join("\n")}
                            </pre>
                          </div>
                        )}
                        {sampleOuts.length > 0 && (
                          <div>
                            <h4 className="mb-1 font-semibold text-slate-900">
                              Sample Output
                            </h4>
                            <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-800">
                              {sampleOuts.join("\n")}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </section>

		          {/* Middle: editor */}
		          <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
		            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
		              <div className="flex flex-wrap items-center gap-2">
		                {Object.keys(files).map((filename) => (
		                  <button
		                    key={filename}
		                    onClick={() => setActiveFilename(filename)}
		                    className={`rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition ${
		                      activeFilename === filename
		                        ? "border-blue-500 bg-blue-50 text-blue-800"
		                        : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
		                    }`}
		                  >
		                    {filename}
		                  </button>
		                ))}
		                <button
		                  onClick={handleAddFile}
		                  disabled={!selectedProblem}
		                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
		                >
		                  + File
		                </button>
		              </div>
			              <div className="flex gap-2">
			                <button
			                  onClick={handleRun}
			                  disabled={
                          !selectedProblem ||
                          running ||
                          submitting ||
                          selectedLanguage === "sql" ||
                          (!canRunMain && selectedLanguage !== "python")
                        }
			                  title={
			                    selectedLanguage === "python"
			                      ? "Runs main.py (harness) and prints solve(...)"
			                      : selectedLanguage === "sql"
			                        ? "SQL uses Run tests"
			                      : canRunMain
			                        ? `Runs ${entryFile}`
			                        : selectedLanguage === "cpp"
			                          ? `Requires int main(...) in ${entryFile}`
			                          : `Requires public static void main(String[] args) in ${entryFile}`
			                  }
			                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
			                >
			                  {running ? "Running..." : `Run (${entryFile})`}
			                </button>
		                <button
		                  onClick={handleRunTests}
		                  disabled={!selectedProblem || submitting || running}
		                  className="rounded-full bg-blue-500 px-4 py-1 text-xs font-semibold text-white shadow-sm hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
	                >
	                  {submitting ? "Running..." : "Run tests"}
	                </button>
	                <button
	                  onClick={() => setShowTests((v) => !v)}
	                  disabled={!selectedProblem || !testSuite}
	                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
	                >
	                  {showTests ? "Hide tests" : "View tests"}
	                </button>
		              </div>
		            </div>
			            {selectedProblem && (selectedLanguage === "java" || selectedLanguage === "cpp") && !canRunMain && (
			              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
			                No <span className="font-mono">main()</span> entrypoint detected in{" "}
			                <span className="font-mono">{entryFile}</span>. Use{" "}
			                <span className="font-semibold">Run tests</span>, or add{" "}
			                <span className="font-mono">
			                  {selectedLanguage === "cpp" ? "int main(...)" : "public static void main(String[] args)"}
			                </span>{" "}
			                to <span className="font-mono">{entryFile}</span>.
			              </div>
			            )}
	            <div className="h-[70vh] min-h-[520px] max-h-[calc(100vh-220px)] overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
		              <Editor
		                height="100%"
		                language={selectedLanguage}
		                value={activeCode}
                    onMount={(editor, monaco) => {
                      editorRef.current = editor;
                      monacoRef.current = monaco;
                      updateTodoDecorations(activeCode);
                    }}
	                onChange={(value) => {
	                  const next = value ?? "";
	                  if (fileRoles[activeFilename] === "readonly") return;
	                  setFiles((prev) => ({ ...prev, [activeFilename]: next }));
	                }}
	                theme="vs-dark"
	                options={{
	                  fontSize: 14,
	                  minimap: { enabled: false },
	                  readOnly: isActiveReadonly,
	                }}
	              />
	            </div>
	          </section>

	          {/* Right: tests / results */}
	          <section className="flex min-h-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs">
	            <div className="flex items-center justify-between">
	              <h2 className="text-sm font-semibold text-slate-900">
	                Feedback
	              </h2>
	              {result && "executionTimeMs" in result && (
	                <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-[11px] text-slate-700">
	                  {result.executionTimeMs?.toFixed(0)} ms
	                </span>
	              )}
	            </div>
	            {showTests && testSuite && (
	              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
	                <div className="flex items-center justify-between">
	                  <h3 className="text-xs font-semibold text-slate-900">
	                    Test suite ({testCount} {testCount === 1 ? "test" : "tests"})
	                  </h3>
	                  <button
	                    onClick={() => setShowTests(false)}
	                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
	                  >
	                    Hide
	                  </button>
	                </div>
	                <pre className="max-h-56 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-800">
	                  {testSuite}
	                </pre>
	              </div>
	            )}
			            {!result && (
			              <p className="text-slate-500">
			                Use <span className="font-semibold">Run tests</span> to see pass/fail.{" "}
			                <span className="font-semibold">Run ({entryFile})</span>{" "}
			                {selectedLanguage === "python"
			                  ? "runs a small harness that calls solve(...) from solution.py."
			                  : `runs whatever you put in ${entryFile}.`}
			              </p>
			            )}
	            {result && "success" in result && (
	              <>
	                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      judgeTimedOut
                        ? "bg-amber-50 text-amber-800"
                        : result.success
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {judgeTimedOut
                      ? "Test run timed out"
                      : result.success
                      ? "All tests passed"
                      : failedTests.length > 0
                      ? `${failedTests.length} test${failedTests.length === 1 ? "" : "s"} failing`
                      : "Test run failed"}
                  </span>
                </div>
                {judgeTimedOut && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    The judge ran out of time. This can happen if your code hangs (infinite loop) or if Docker is slow to start.
                    You can increase the backend timeout via <span className="font-mono">JUDGE_TIMEOUT_MS</span>.
                  </div>
                )}
                <div className="space-y-2">
                  {(() => {
                    const all = sortTestCaseNames([...passedTests, ...failedTests]);

                    const suite = selectedLanguage === "sql" ? tryParseSqlSuite(testSuite) : null;
                    const sqlByName = new Map<string, { input: string; expected: string }>();
                    if (suite) {
                      for (const c of suite.cases) {
                        sqlByName.set(c.name, {
                          input: [`-- schema_sql`, suite.schema_sql.trim(), `\n-- seed_sql`, c.seed_sql.trim()]
                            .filter(Boolean)
                            .join("\n"),
                          expected: formatSqlExpected(c.expected.columns, c.expected.rows),
                        });
                      }
                    }

                    const sqlMismatchBlocks =
                      selectedLanguage === "sql" ? parseSqlMismatchBlocks(result.stderr || "") : [];
                    const sqlFailNames = sortTestCaseNames(failedTests);
                    const sqlExtraByFailName = new Map<string, { actual?: string; message?: string }>();
                    if (selectedLanguage === "sql" && sqlMismatchBlocks.length > 0) {
                      for (let i = 0; i < Math.min(sqlFailNames.length, sqlMismatchBlocks.length); i++) {
                        const name = sqlFailNames[i]!;
                        const b = sqlMismatchBlocks[i]!;
                        sqlExtraByFailName.set(name, { actual: b.actual, message: b.message });
                      }
                    }

                    return (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-slate-900">Test cases</h3>
                        {all.length === 0 && (
                          <p className="text-xs text-slate-500">
                            {result.success
                              ? "None"
                              : "No tests were reported. Open details/diagnostics — this usually means a compile error, crash, or timeout."}
                          </p>
                        )}
                        <div className="space-y-2">
                          {all.map((t) => {
                            const passed = passedTests.includes(t);
                            const junitInfo = junitFailures[t];
                            const junitParsed = junitInfo?.message ? parseExpectedActual(junitInfo.message) : null;

                            const suiteInfo = sqlByName.get(t);
                            const sqlExtra = sqlExtraByFailName.get(t);

                            const fromStructured = result.testCaseDetails?.find((x) => x.name === t);

                            const input = suiteInfo?.input ?? fromStructured?.input;
                            const expectedOutput = suiteInfo?.expected ?? (junitParsed ? junitParsed.expected : undefined) ?? fromStructured?.expectedOutput;
                            const actualOutput = sqlExtra?.actual ?? (junitParsed ? junitParsed.actual : undefined) ?? fromStructured?.actualOutput;
                            const message = junitInfo?.message ?? sqlExtra?.message ?? fromStructured?.message;

                            return (
                              <details
                                key={t}
                                className={`group rounded-lg border p-2 ${
                                  passed ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
                                }`}
                              >
                                <summary className="cursor-pointer list-none select-none">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className={`font-semibold ${passed ? "text-emerald-800" : "text-rose-800"}`}>
                                      {passed ? "✓" : "✗"} {t}
                                    </div>
                                    <div className="text-[11px] text-slate-600 group-open:hidden">Show</div>
                                    <div className="hidden text-[11px] text-slate-600 group-open:block">Hide</div>
                                  </div>
                                </summary>
                                <div className="mt-2 space-y-2">
                                  <div className="grid gap-2 md:grid-cols-2">
                                    <div className="rounded border border-slate-200 bg-white p-2">
                                      <div className="text-[11px] font-semibold text-slate-900">Expected input</div>
                                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                                        {input || "(not available)"}
                                      </pre>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-white p-2">
                                      <div className="text-[11px] font-semibold text-slate-900">Your input</div>
                                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                                        {input || "(not available)"}
                                      </pre>
                                    </div>
                                  </div>
                                  <div className="grid gap-2 md:grid-cols-2">
                                    <div className="rounded border border-slate-200 bg-white p-2">
                                      <div className="text-[11px] font-semibold text-slate-900">Expected output</div>
                                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                                        {expectedOutput || "(not available)"}
                                      </pre>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-white p-2">
                                      <div className="text-[11px] font-semibold text-slate-900">Your output</div>
                                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                                        {actualOutput || "(not available)"}
                                      </pre>
                                    </div>
                                  </div>
                                  {message && (
                                    <div className="rounded border border-slate-200 bg-white p-2">
                                      <div className="text-[11px] font-semibold text-slate-900">Notes</div>
                                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                                        {message}
                                      </pre>
                                      {junitInfo?.location && (
                                        <div className="mt-2 text-[11px] text-slate-600">
                                          Location: <span className="font-mono">{junitInfo.location}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => setShowDetails((v) => !v)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
                    >
                      {showDetails ? "Hide details" : "Show details"}
                    </button>
                    <button
                      onClick={() => setShowDiagnostics((v) => !v)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
                    >
                      {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
                    </button>
                  </div>
                  {showDetails && (
                    <div className="space-y-1 pt-2">
                      <h3 className="text-xs font-semibold text-slate-900">Test runner output</h3>
                      <pre className="max-h-[38vh] overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                        {stripAnsi(result.stdout || "") || "(empty)"}
                      </pre>
                    </div>
                  )}
                  {showDiagnostics && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold text-slate-900">Diagnostics</h3>
                      {(judgeExitCode != null || judgeTimedOut) && (
                        <div className="text-[11px] text-slate-600">
                          {judgeExitCode != null && (
                            <>
                              Exit code: <span className="font-mono">{judgeExitCode}</span>
                            </>
                          )}
                          {judgeTimedOut && (
                            <>
                              {judgeExitCode != null ? " · " : ""}
                              Timed out
                            </>
                          )}
                        </div>
                      )}
                      <pre className="max-h-[24vh] overflow-auto rounded border border-slate-200 bg-rose-50/60 p-2 font-mono text-[11px] text-rose-800">
                        {normalizeDiagnostics(result.stderr || "") || "(empty)"}
                      </pre>
                    </div>
                  )}
	              </>
	            )}
            {result && !("success" in result) && (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowDetails((v) => !v)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
                  >
                    {showDetails ? "Hide output" : "Show output"}
                  </button>
                  <button
                    onClick={() => setShowDiagnostics((v) => !v)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
                  >
                    {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
                  </button>
                </div>
                {showDetails && (
                  <div className="space-y-1 pt-1">
                    <h3 className="text-xs font-semibold text-slate-900">Program output</h3>
                    <pre className="max-h-[38vh] overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                      {stripAnsi(result.stdout || "") || "(empty)"}
                    </pre>
                  </div>
                )}
                {showDiagnostics && (
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-slate-900">Diagnostics</h3>
                    <pre className="max-h-[24vh] overflow-auto rounded border border-slate-200 bg-rose-50/60 p-2 font-mono text-[11px] text-rose-800">
                      {normalizeDiagnostics(result.stderr || "") || "(empty)"}
                    </pre>
                  </div>
                )}
              </>
            )}
	          </section>
        </main>
      </div>
    </div>
  );
}
