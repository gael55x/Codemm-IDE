"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Editor from "@monaco-editor/react";

type Problem = {
  id: string;
  title: string;
  description: string;
  classSkeleton: string;
  testSuite: string;
  constraints: string;
  sampleInputs: string[];
  sampleOutputs: string[];
};

type Activity = {
  id: string;
  title: string;
  prompt: string;
  problems: Problem[];
  createdAt: string;
};

type JudgeResult = {
  success: boolean;
  passedTests: string[];
  failedTests: string[];
  stdout: string;
  stderr: string;
  executionTimeMs: number;
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export default function ActivityPage() {
  const params = useParams<{ id: string }>();
  const activityId = params.id;

  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(
    null
  );
  const [code, setCode] = useState<string>("public class Solution {\n}\n");
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${BACKEND_URL}/activities/${activityId}`);
        const data = await res.json();
        const act = data.activity as Activity | undefined;
        if (act) {
          setActivity(act);
          if (act.problems.length > 0) {
            const first = act.problems[0];
            setSelectedProblemId(first.id);
            setCode(first.classSkeleton || "public class Solution {\n}\n");
          }
          setIsTimerRunning(true);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activityId]);

  useEffect(() => {
    if (!isTimerRunning) return;
    const id = setInterval(() => {
      setTimerSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [isTimerRunning]);

  const selectedProblem = activity?.problems.find(
    (p) => p.id === selectedProblemId
  );

  async function handleSubmit() {
    if (!selectedProblem) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          testSuite: selectedProblem.testSuite,
        }),
      });
      const data: JudgeResult = await res.json();
      setResult(data);
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
        <div className="rounded-lg bg-white px-4 py-3 text-sm shadow">
          Activity not found.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4">
        <header className="flex items-center justify-between gap-4 rounded-lg bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Activity
            </div>
            <h1 className="text-lg font-semibold tracking-tight">
              {activity.title}
            </h1>
            <p className="text-xs text-slate-500">
              CodeChum-style activity with {activity.problems.length} Java OOP
              problems.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-slate-100 px-4 py-1 text-xs font-semibold text-emerald-700">
              Time: {formatTime(timerSeconds)}
            </div>
          </div>
        </header>

        <main className="grid gap-3 md:grid-cols-[minmax(260px,1.5fr)_minmax(0,2.4fr)_minmax(220px,1.3fr)]">
          {/* Left column: problems + description */}
          <section className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Problems
            </h2>
            <div className="flex flex-col gap-2">
              {activity.problems.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedProblemId(p.id);
                    setCode(p.classSkeleton || "public class Solution {\n}\n");
                    setResult(null);
                    setTimerSeconds(0);
                    setIsTimerRunning(true);
                  }}
                  className={`flex flex-col rounded-md border px-3 py-2 text-left text-sm transition ${
                    selectedProblemId === p.id
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-200 bg-white hover:border-slate-400"
                  }`}
                >
                  <span className="font-medium text-slate-900">
                    {p.title}
                  </span>
                  <span className="line-clamp-2 text-xs text-slate-500">
                    {p.description}
                  </span>
                </button>
              ))}
            </div>

            {selectedProblem && (
              <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                <h3 className="text-sm font-semibold text-slate-900">
                  Description
                </h3>
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
                {(selectedProblem.sampleInputs.length > 0 ||
                  selectedProblem.sampleOutputs.length > 0) && (
                  <div className="grid gap-2 pt-2 text-xs sm:grid-cols-2">
                    {selectedProblem.sampleInputs.length > 0 && (
                      <div>
                        <h4 className="mb-1 font-semibold text-slate-900">
                          Sample Input
                        </h4>
                        <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-800">
                          {selectedProblem.sampleInputs.join("\n")}
                        </pre>
                      </div>
                    )}
                    {selectedProblem.sampleOutputs.length > 0 && (
                      <div>
                        <h4 className="mb-1 font-semibold text-slate-900">
                          Sample Output
                        </h4>
                        <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-800">
                          {selectedProblem.sampleOutputs.join("\n")}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Middle column: editor */}
          <section className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Main.java</h2>
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={!selectedProblem || submitting}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Run code
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!selectedProblem || submitting}
                  className="rounded-md bg-emerald-500 px-4 py-1 text-xs font-semibold text-white shadow hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Checking..." : "Check code"}
                </button>
              </div>
            </div>
            <div className="h-80 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
              <Editor
                height="100%"
                defaultLanguage="java"
                value={code}
                onChange={(value) => setCode(value ?? "")}
                theme="vs-dark"
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                }}
              />
            </div>
          </section>

          {/* Right column: tests / results panel */}
          <section className="flex flex-col gap-3 rounded-lg bg-white p-4 text-xs shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Tests</h2>
            {!result && (
              <p className="text-slate-500">
                Submit your code to see which test cases pass or fail.
              </p>
            )}
            {result && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      result.success
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {result.success ? "All tests passed" : "Tests failed"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-[11px] text-slate-700">
                    {result.executionTimeMs.toFixed(0)} ms
                  </span>
                </div>
                <div className="space-y-2">
                  <div>
                    <h3 className="mb-1 text-xs font-semibold text-emerald-700">
                      Passed tests
                    </h3>
                    {result.passedTests.length === 0 && (
                      <p className="text-xs text-slate-500">None</p>
                    )}
                    <ul className="space-y-1 text-xs text-slate-800">
                      {result.passedTests.map((t) => (
                        <li key={t}>✓ {t}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1 text-xs font-semibold text-rose-700">
                      Failed tests
                    </h3>
                    {result.failedTests.length === 0 && (
                      <p className="text-xs text-slate-500">None</p>
                    )}
                    <ul className="space-y-1 text-xs text-slate-800">
                      {result.failedTests.map((t) => (
                        <li key={t}>✗ {t}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="space-y-1 pt-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    Output
                  </h3>
                  <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                    {result.stdout || "(empty)"}
                  </pre>
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-slate-900">
                    Hints / Errors
                  </h3>
                  <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-rose-50/60 p-2 font-mono text-[11px] text-rose-800">
                    {result.stderr || "(empty)"}
                  </pre>
                </div>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}


