"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSpecBuilderUX } from "@/lib/specBuilderUx";
import type { GenerationProgressEvent } from "@/types/generationProgress";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  tone?: "question" | "hint" | "info";
};

type ProblemPhase = "queued" | "generating" | "validating" | "retrying" | "validated" | "failed";
type ProblemProgress = {
  phase: ProblemPhase;
  attempt: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
  lastFailure: "validation" | "generation" | null;
};

type GenerationProgressState = {
  totalProblems: number;
  run: number;
  problems: ProblemProgress[];
  error: string | null;
};

export default function Home() {
  const router = useRouter();
  const { interpretResponse, formatSlotPrompt, normalizeInput, activeSlot } = useSpecBuilderUX();
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [specReady, setSpecReady] = useState(false);
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);
  const [progressHint, setProgressHint] = useState<string | null>(null);
  const progressRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("codem-theme");
    if (stored === "dark") {
      setDarkMode(true);
    }

    // Check if user is logged in
    const token = localStorage.getItem("codem-token");
    const storedUser = localStorage.getItem("codem-user");
    if (token && storedUser) {
      setUser(JSON.parse(storedUser));
    }

    // Create a new session on mount
    async function initSession() {
      try {
        const res = await fetch(`${BACKEND_URL}/sessions`, {
          method: "POST",
        });
        const data = await res.json();
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
      } catch (e) {
        console.error("Failed to create session:", e);
      }
    }
    initSession();
  }, []);

  useEffect(() => {
    return () => {
      try {
        progressRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("codem-theme", newMode ? "dark" : "light");
  };

  function renderOverallPercent(p: GenerationProgressState): number {
    const validated = p.problems.filter((x) => x.phase === "validated").length;
    const total = p.totalProblems || 1;
    return Math.max(0, Math.min(100, Math.round((validated / total) * 100)));
  }

  function renderProblemStatus(p: ProblemProgress): string {
    if (p.phase === "queued") return "Queued";
    if (p.phase === "validated") return "Validated";
    if (p.phase === "failed") return "Failed";
    if (p.phase === "generating") return `Generating${p.attempt ? ` (attempt ${p.attempt})` : ""}`;
    if (p.phase === "validating") return `Validating${p.attempt ? ` (attempt ${p.attempt})` : ""}`;
    if (p.phase === "retrying") {
      const prefix = p.lastFailure === "validation" ? "Validation failed, retrying…" : "Retrying…";
      return `${prefix}${p.attempt ? ` (attempt ${p.attempt})` : ""}`;
    }
    return "Queued";
  }

  function renderProblemPercent(p: ProblemProgress): number {
    if (p.phase === "validated") return 100;
    if (p.phase === "failed") return 100;
    if (p.phase === "queued") return 0;
    if (p.phase === "validating") return 66;
    if (p.phase === "generating") return 33;
    if (p.phase === "retrying") {
      return p.lastFailure === "validation" ? 66 : 33;
    }
    return 0;
  }

  async function handleChatSend() {
    if (!sessionId) return;

    const rawInput = chatInput.trim();
    if (!rawInput) return;

    const normalized = normalizeInput(rawInput);
    if (!normalized.ok) return;
    const userMessage = rawInput;

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: normalized.value }),
      });
      const data = await res.json();

      interpretResponse(data);

      setSpecReady(data.done === true);

      if (typeof data.nextQuestion === "string" && data.nextQuestion.trim()) {
        const assistantTone: ChatMessage["tone"] = data.accepted ? "question" : "hint";
        const assistantContent =
          data.accepted
            ? data.nextQuestion
            : [data.error, data.nextQuestion].filter(Boolean).join("\n\n");

        setMessages((prev) => [
          ...prev,
          { role: "assistant", tone: assistantTone, content: assistantContent },
        ]);
      } else {
        const fallback = formatSlotPrompt(activeSlot) ?? "Please continue.";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", tone: "question", content: fallback },
        ]);
      }
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          tone: "hint",
          content:
            "Sorry, something went wrong processing your answer. Please try again in the expected format.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleGenerate() {
    const token = localStorage.getItem("codem-token");
    if (!token) {
      router.push("/auth/login");
      return;
    }

    if (!sessionId || !specReady) {
      return;
    }

    setLoading(true);
    try {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          tone: "info",
          content: "Generating activity... please wait.",
        },
      ]);

      // Open structured progress stream (no prompts, no reasoning, no logs).
      setProgress(null);
      setProgressHint(null);
      try {
        progressRef.current?.close();
      } catch {
        // ignore
      }

      const es = new EventSource(`${BACKEND_URL}/sessions/${sessionId}/generate/stream`);
      progressRef.current = es;

      const hintTimer = window.setTimeout(() => {
        setProgressHint("Progress stream unavailable.");
      }, 1200);

      es.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data) as any;
          if (payload?.event === "progress.ready") {
            window.clearTimeout(hintTimer);
            return;
          }

          const ev = payload as GenerationProgressEvent;
          if (!ev || typeof ev.type !== "string") return;
          window.clearTimeout(hintTimer);

          setProgress((prev) => {
            if (ev.type === "generation_started") {
              const total = Math.max(1, ev.totalProblems);
              const problems: ProblemProgress[] = Array.from({ length: total }, () => ({
                phase: "queued",
                attempt: null,
                difficulty: null,
                lastFailure: null,
              }));
              return { totalProblems: total, run: ev.run ?? 1, problems, error: null };
            }

            if (!prev) return prev;

            const next: GenerationProgressState = {
              ...prev,
              problems: prev.problems.map((p) => ({ ...p })),
            };

            if (ev.type === "problem_started") {
              const p = next.problems[ev.index];
              if (p) {
                p.difficulty = ev.difficulty;
                p.phase = "generating";
                p.attempt = null;
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "attempt_started") {
              const p = next.problems[ev.index];
              if (p) {
                p.phase = "generating";
                p.attempt = ev.attempt;
              }
              return next;
            }

            if (ev.type === "validation_started") {
              const p = next.problems[ev.index];
              if (p) {
                p.phase = "validating";
                p.attempt = ev.attempt;
              }
              return next;
            }

            if (ev.type === "validation_failed") {
              const p = next.problems[ev.index];
              if (p) {
                p.phase = "retrying";
                p.attempt = ev.attempt;
                p.lastFailure = "validation";
              }
              return next;
            }

            if (ev.type === "attempt_failed") {
              const p = next.problems[ev.index];
              if (p) {
                p.phase = "retrying";
                p.attempt = ev.attempt;
                p.lastFailure = ev.phase === "validate" ? "validation" : "generation";
              }
              return next;
            }

            if (ev.type === "problem_validated") {
              const p = next.problems[ev.index];
              if (p) {
                p.phase = "validated";
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "problem_failed") {
              const p = next.problems[ev.index];
              if (p) p.phase = "failed";
              return next;
            }

            if (ev.type === "generation_failed") {
              next.error = ev.error || "Generation failed.";
              for (const p of next.problems) {
                if (p.phase !== "validated") p.phase = "failed";
              }
              return next;
            }

            return next;
          });
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        window.clearTimeout(hintTimer);
        setProgressHint((prev) => prev ?? "Progress stream disconnected.");
        try {
          es.close();
        } catch {
          // ignore
        }
      };

      const res = await fetch(`${BACKEND_URL}/sessions/${sessionId}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (typeof data.activityId === "string") {
        try {
          progressRef.current?.close();
        } catch {
          // ignore
        }
        router.push(`/activity/${data.activityId}`);
      } else if (data?.error) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            tone: "hint",
            content: `Failed to generate activity: ${data.error} ${data.detail ?? ""}`,
          },
        ]);
      }
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          tone: "hint",
          content: "Failed to generate activity. Please try again.",
        },
      ]);
    } finally {
      try {
        progressRef.current?.close();
      } catch {
        // ignore
      }
      setLoading(false);
    }
  }

  const isBusy = chatLoading || loading;
  const displayName =
    (typeof user?.displayName === "string" && user.displayName.trim()
      ? user.displayName
      : typeof user?.display_name === "string" && user.display_name.trim()
        ? user.display_name
        : typeof user?.username === "string" && user.username.trim()
          ? user.username
          : "Gaille") as string;

  return (
    <div className={`min-h-screen transition-colors ${darkMode ? "bg-slate-900" : "bg-white"}`}>
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8">
        {/* Clean Apple-style header */}
        <header className={`mb-8 flex items-center justify-between border-b pb-6 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          <div>
            <h1 className={`text-3xl font-semibold tracking-tight ${darkMode ? "text-white" : "text-slate-900"}`}>
              Codemm
            </h1>
            <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
              AI coding activity generator
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleDarkMode}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                darkMode 
                  ? "bg-slate-800 text-slate-300 hover:bg-slate-700" 
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              aria-label="Toggle dark mode"
            >
              {darkMode ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            {user ? (
              <button
                onClick={() => router.push("/profile")}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  darkMode
                    ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {displayName}
              </button>
            ) : (
              <button
                onClick={() => router.push("/auth/login")}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  darkMode
                    ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Login
              </button>
            )}
            {!loading && (
              <button
                onClick={handleGenerate}
                disabled={!specReady || isBusy}
                className="rounded-full bg-blue-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Generate Activity
              </button>
            )}
            {loading && (
              <div className={`flex items-center gap-2 text-sm ${darkMode ? "text-slate-400" : "text-slate-600"}`}>
                <span className={`h-4 w-4 animate-spin rounded-full border-2 ${darkMode ? "border-slate-700 border-t-blue-400" : "border-slate-300 border-t-blue-500"}`} />
                <span>Generating...</span>
              </div>
            )}
          </div>
        </header>

        {/* Clean chat area */}
        <main className="flex flex-1 flex-col">
          <div className="mb-4 flex-1 space-y-4 overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className={`mb-3 flex h-16 w-16 items-center justify-center rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                  <span className={`text-2xl font-bold ${darkMode ? "text-slate-500" : "text-slate-400"}`}>C</span>
                </div>
                <h2 className={`mb-2 text-lg font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                  Create a new activity
                </h2>
                <p className={`mb-6 max-w-md text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                  Answer a few questions and Codemm will generate a complete practice activity: problems, starter code, and automated tests.
                </p>
                {formatSlotPrompt(activeSlot) && (
                  <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                    {formatSlotPrompt(activeSlot)}
                  </p>
                )}
              </div>
            )}
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                    m.role === "user"
                      ? "bg-blue-500 text-white shadow-sm"
                      : m.tone === "question"
                        ? darkMode
                          ? "border border-slate-700 bg-slate-800 text-slate-100"
                          : "border border-slate-200 bg-slate-50 text-slate-900"
                        : m.tone === "hint"
                          ? darkMode
                            ? "border border-amber-700/60 bg-amber-900/30 text-amber-100"
                            : "border border-amber-200 bg-amber-50 text-amber-900"
                          : m.tone === "info"
                            ? darkMode
                              ? "border border-slate-700 bg-slate-900/60 text-slate-100"
                              : "border border-blue-100 bg-blue-50 text-slate-900"
                            : darkMode
                              ? "bg-slate-800 text-slate-100"
                              : "bg-slate-100 text-slate-900"
                  }`}
                >
                  {m.tone && m.role === "assistant" && (
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-80">
                      {m.tone === "question"
                        ? "Next step"
                        : m.tone === "hint"
                          ? "Tutor hint"
                          : "Note"}
                    </div>
                  )}
                  {m.content}
                  {loading &&
                    m.role === "assistant" &&
                    m.tone === "info" &&
                    m.content.trim() === "Generating activity... please wait." && (
                      <div className="mt-3 space-y-2">
                        {progressHint && (
                          <div
                            className={`rounded-lg px-3 py-2 text-[11px] ${
                              darkMode
                                ? "bg-amber-900/30 text-amber-200"
                                : "bg-amber-50 text-amber-900"
                            }`}
                          >
                            {progressHint}
                          </div>
                        )}

                        {progress ? (
                          <>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] opacity-80">
                                <div>Overall progress</div>
                                <div>{renderOverallPercent(progress)}%</div>
                              </div>
                              <div
                                className={`h-2 w-full overflow-hidden rounded-full ${
                                  darkMode ? "bg-slate-800" : "bg-slate-100"
                                }`}
                              >
                                <div
                                  className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                                  style={{ width: `${renderOverallPercent(progress)}%` }}
                                />
                              </div>
                            </div>

                            {progress.error && (
                              <div
                                className={`rounded-lg px-3 py-2 text-[11px] ${
                                  darkMode
                                    ? "bg-rose-900/30 text-rose-200"
                                    : "bg-rose-50 text-rose-900"
                                }`}
                              >
                                {progress.error}
                              </div>
                            )}

                            <div
                              className={`space-y-2 rounded-xl border p-3 ${
                                darkMode
                                  ? "border-slate-700 bg-slate-950/40"
                                  : "border-slate-200 bg-white/40"
                              }`}
                            >
                              {progress.problems.map((p, i) => {
                                const percent = renderProblemPercent(p);
                                const active = p.phase === "generating" || p.phase === "validating" || p.phase === "retrying";
                                return (
                                  <div key={i} className="space-y-1">
                                    <div className="flex items-center justify-between gap-3 text-[12px]">
                                      <div className={`truncate ${active ? "font-medium" : ""}`}>
                                        Problem {i + 1}/{progress.totalProblems}
                                        {p.difficulty ? ` — ${p.difficulty}` : ""}
                                      </div>
                                      <div className={`shrink-0 tabular-nums ${active ? "animate-pulse" : "opacity-80"}`}>
                                        {percent}%
                                      </div>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-[11px] opacity-80">
                                      <div className={`truncate ${active ? "animate-pulse" : ""}`}>
                                        {renderProblemStatus(p)}
                                      </div>
                                    </div>
                                    <div
                                      className={`h-1.5 w-full overflow-hidden rounded-full ${
                                        darkMode ? "bg-slate-800" : "bg-slate-200"
                                      }`}
                                    >
                                      <div
                                        className={`h-full rounded-full transition-[width] duration-300 ${
                                          p.phase === "failed" ? "bg-rose-500" : "bg-emerald-500"
                                        }`}
                                        style={{ width: `${percent}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <div className="text-[11px] opacity-70">Waiting for progress events…</div>
                        )}
                      </div>
                    )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                  <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${darkMode ? "bg-slate-500" : "bg-slate-400"}`} style={{ animationDelay: "0ms" }} />
                  <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${darkMode ? "bg-slate-500" : "bg-slate-400"}`} style={{ animationDelay: "150ms" }} />
                  <span className={`h-1.5 w-1.5 animate-bounce rounded-full ${darkMode ? "bg-slate-500" : "bg-slate-400"}`} style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className={`border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <textarea
                  className={`w-full resize-none rounded-xl border px-4 py-3 text-sm outline-none transition focus:ring-1 ${
                    darkMode 
                      ? "border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-500 focus:border-blue-400 focus:ring-blue-400" 
                      : "border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-blue-500"
                  }`}
                  placeholder="Type your answer..."
                  rows={3}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (chatInput.trim()) handleChatSend();
                    }
                  }}
                  disabled={isBusy || specReady}
                />
              </div>
              <button
                onClick={handleChatSend}
                disabled={chatLoading || !chatInput.trim() || specReady}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            {specReady && (
              <div className={`mt-3 rounded-lg px-4 py-2 text-xs ${darkMode ? "bg-emerald-900/30 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}>
                ✓ Activity spec is ready. Click "Generate Activity" to create problems.
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
