"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSpecBuilderUX } from "@/lib/specBuilderUx";
import type {
  Difficulty,
  GenerationLanguage,
  GenerationProgressEvent,
} from "@/types/generationProgress";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  tone?: "question" | "hint" | "info";
  summary?: string;
  assumptions?: string[];
};

type SlotStage = "queued" | "llm" | "contract" | "docker" | "done" | "failed";
type SlotProgress = {
  stage: SlotStage;
  attempt: number;
  difficulty: Difficulty | null;
  topic: string | null;
  language: GenerationLanguage | null;
  stageDone: { llm: boolean; contract: boolean; docker: boolean };
  lastFailure: { stage: "contract" | "docker"; message: string } | null;
};

type GenerationProgressState = {
  totalSlots: number;
  run: number;
  slots: SlotProgress[];
  error: string | null;
  lastHeartbeatTs: string | null;
};

type LearningMode = "practice" | "guided";

export default function Home() {
  const router = useRouter();
  const { interpretResponse, formatSlotPrompt, normalizeInput, activeSlot } = useSpecBuilderUX();
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [user, setUser] = useState<any>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [learningMode, setLearningMode] = useState<LearningMode>("practice");
  const [generationLocked, setGenerationLocked] = useState(false);
  const [specReady, setSpecReady] = useState(false);
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);
  const [progressHint, setProgressHint] = useState<string | null>(null);
  const progressRef = useRef<EventSource | null>(null);

  const handleLogoClick = () => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

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

  }, []);

  useEffect(() => {
    // Create a new session (mode is set at creation time).
    async function initSession() {
      try {
        try {
          progressRef.current?.close();
        } catch {
          // ignore
        }
        setSessionId(null);
        setSpecReady(false);
        setProgress(null);
        setProgressHint(null);
        setGenerationLocked(false);
        setMessages([]);
        setChatInput("");
        setHasInteracted(false);

        const res = await fetch(`${BACKEND_URL}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ learning_mode: learningMode }),
        });
        const data = await res.json();
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
        if (typeof data.nextQuestion === "string" && data.nextQuestion.trim()) {
          setMessages([
            {
              role: "assistant",
              tone: "question",
              content: data.nextQuestion,
              summary: typeof data.assistant_summary === "string" ? data.assistant_summary : undefined,
              assumptions: Array.isArray(data.assumptions) ? data.assumptions : undefined,
            },
          ]);
        }
      } catch (e) {
        console.error("Failed to create session:", e);
      }
    }
    initSession();
  }, [learningMode]);

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
    const done = p.slots.filter((x) => x.stage === "done").length;
    const total = p.totalSlots || 1;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }

  function renderSlotStatus(p: SlotProgress): string {
    if (p.stage === "queued") return "Queued";
    if (p.stage === "done") return "Done";
    if (p.stage === "failed") return "Failed";
    if (p.lastFailure) return `Retrying… (attempt ${Math.min(3, p.attempt + 1)}/3)`;
    if (p.stage === "llm") return p.attempt ? `Generating (attempt ${p.attempt}/3)` : "Generating";
    if (p.stage === "contract") return p.attempt ? `Validating contract (attempt ${p.attempt}/3)` : "Validating contract";
    if (p.stage === "docker") return p.attempt ? `Validating in Docker (attempt ${p.attempt}/3)` : "Validating in Docker";
    return "Queued";
  }

  function renderSlotPercent(p: SlotProgress): number {
    if (p.stage === "done") return 100;
    if (p.stage === "failed") return 100;
    if (p.stage === "queued") return 0;
    if (p.stage === "llm") return 25;
    if (p.stage === "contract") return 50;
    if (p.stage === "docker") return 75;
    return 0;
  }

  async function handleChatSend() {
    if (!sessionId) return;

    const rawInput = chatInput.trim();
    if (!rawInput) return;

    const normalized = normalizeInput(rawInput);
    if (!normalized.ok) return;
    const userMessage = rawInput;

    setHasInteracted(true);
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
        const summary = typeof (data as any).assistant_summary === "string" ? (data as any).assistant_summary : undefined;
        const assumptions = Array.isArray((data as any).assumptions) ? (data as any).assumptions : undefined;

        setMessages((prev) => [
          ...prev,
          { role: "assistant", tone: assistantTone, content: assistantContent, summary, assumptions },
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
    setGenerationLocked(true);
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
              const total = Math.max(1, ev.totalSlots ?? ev.totalProblems ?? 1);
              const slots: SlotProgress[] = Array.from({ length: total }, () => ({
                stage: "queued",
                attempt: 0,
                difficulty: null,
                topic: null,
                language: null,
                stageDone: { llm: false, contract: false, docker: false },
                lastFailure: null,
              }));
              return { totalSlots: total, run: ev.run ?? 1, slots, error: null, lastHeartbeatTs: null };
            }

            if (!prev) return prev;

            const next: GenerationProgressState = {
              ...prev,
              slots: prev.slots.map((p) => ({
                ...p,
                stageDone: { ...p.stageDone },
                lastFailure: p.lastFailure ? { ...p.lastFailure } : null,
              })),
            };

            if (ev.type === "heartbeat") {
              next.lastHeartbeatTs = ev.ts;
              return next;
            }

            const getSlot = (slotIndex: number) => next.slots[slotIndex];

            if (ev.type === "slot_started") {
              const p = getSlot(ev.slotIndex);
              if (p) {
                p.difficulty = ev.difficulty;
                p.topic = ev.topic;
                p.language = ev.language;
                if (p.stage === "queued") p.stage = "llm";
              }
              return next;
            }

            if (ev.type === "slot_llm_attempt_started") {
              const p = getSlot(ev.slotIndex);
              if (p) {
                p.stage = "llm";
                p.attempt = ev.attempt;
                p.stageDone = { llm: false, contract: false, docker: false };
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "slot_contract_validated") {
              const p = getSlot(ev.slotIndex);
              if (p) {
                p.stage = "docker";
                p.attempt = ev.attempt;
                p.stageDone.llm = true;
                p.stageDone.contract = true;
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "slot_contract_failed") {
              const p = getSlot(ev.slotIndex);
              if (p) {
                p.stage = "contract";
                p.attempt = ev.attempt;
                p.lastFailure = { stage: "contract", message: ev.shortError };
              }
              return next;
            }

            if (ev.type === "slot_docker_validation_started") {
              const p = getSlot(ev.slotIndex);
              if (p) {
                p.stage = "docker";
                p.attempt = ev.attempt;
                p.stageDone.llm = true;
                p.stageDone.contract = true;
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "slot_docker_validation_failed") {
              const p = getSlot(ev.slotIndex);
              if (p) {
                p.stage = "docker";
                p.attempt = ev.attempt;
                p.lastFailure = { stage: "docker", message: ev.shortError };
              }
              return next;
            }

            if (ev.type === "slot_completed") {
              const p = getSlot(ev.slotIndex);
              if (p) {
                p.stage = "done";
                p.stageDone = { llm: true, contract: true, docker: true };
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "problem_started") {
              const p = getSlot(ev.index);
              if (p) {
                p.difficulty = ev.difficulty;
                p.stage = "llm";
                p.attempt = 0;
                p.stageDone = { llm: false, contract: false, docker: false };
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "attempt_started") {
              const p = getSlot(ev.index);
              if (p) {
                p.stage = "llm";
                p.attempt = ev.attempt;
                p.stageDone = { llm: false, contract: false, docker: false };
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "validation_started") {
              const p = getSlot(ev.index);
              if (p) {
                p.stage = "docker";
                p.attempt = ev.attempt;
                p.stageDone.llm = true;
                p.stageDone.contract = true;
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "validation_failed") {
              const p = getSlot(ev.index);
              if (p) {
                p.stage = "docker";
                p.attempt = ev.attempt;
                p.lastFailure = { stage: "docker", message: "Docker validation failed." };
              }
              return next;
            }

            if (ev.type === "attempt_failed") {
              const p = getSlot(ev.index);
              if (p) {
                p.attempt = ev.attempt;
                p.lastFailure =
                  ev.phase === "validate"
                    ? { stage: "docker", message: "Docker validation failed." }
                    : { stage: "contract", message: "Contract validation failed." };
              }
              return next;
            }

            if (ev.type === "problem_validated") {
              const p = getSlot(ev.index);
              if (p) {
                p.stage = "done";
                p.stageDone = { llm: true, contract: true, docker: true };
                p.lastFailure = null;
              }
              return next;
            }

            if (ev.type === "problem_failed") {
              const p = getSlot(ev.index);
              if (p) p.stage = "failed";
              return next;
            }

            if (ev.type === "generation_failed") {
              next.error = ev.error || "Generation failed.";
              if (typeof ev.slotIndex === "number") {
                const p = getSlot(ev.slotIndex);
                if (p && p.stage !== "done") p.stage = "failed";
              } else {
                for (const p of next.slots) {
                  if (p.stage !== "done") p.stage = "failed";
                }
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
  const isPromptExpanded = hasInteracted || chatInput.trim().length > 0;
  const displayName =
    (typeof user?.displayName === "string" && user.displayName.trim()
      ? user.displayName
      : typeof user?.display_name === "string" && user.display_name.trim()
        ? user.display_name
        : typeof user?.username === "string" && user.username.trim()
          ? user.username
          : "Gaille") as string;

  return (
    <div
      className={`relative min-h-screen overflow-x-hidden transition-colors ${
        darkMode ? "bg-slate-950 text-slate-50" : "bg-slate-50 text-slate-900"
      }`}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className={`absolute left-1/2 top-10 -z-10 h-[520px] w-[520px] -translate-x-1/2 rotate-6 rounded-[42px] border ${
            darkMode ? "border-sky-900/40 bg-slate-900/60" : "border-sky-100 bg-white"
          } shadow-[0_40px_120px_-60px_rgba(15,23,42,0.55)]`}
        >
          <div
            className="absolute inset-4 rounded-[32px] opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(59,130,246,0.25) 1px, transparent 0)",
              backgroundSize: "36px 36px",
            }}
          />
          <div
            className="absolute inset-0 rounded-[42px]"
            style={{
              background:
                "conic-gradient(from 110deg at 50% 50%, rgba(59,130,246,0.09), transparent 40%, rgba(59,130,246,0.14), transparent 70%)",
            }}
          />
        </div>
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 pb-16">
        <header
          className={`sticky top-0 z-30 flex flex-col gap-4 py-6 lg:flex-row lg:items-center lg:justify-between transition-all duration-300 ${
            isPromptExpanded ? "translate-y-0 opacity-100" : "opacity-100 translate-y-0"
          } ${darkMode ? "bg-slate-950/90" : "bg-slate-50/95"} backdrop-blur`}
        >
          <Link
            href="/"
            onClick={handleLogoClick}
            className="flex items-center gap-3 hover:opacity-90 transition focus:outline-none cursor-pointer"
            aria-label="Go to home"
          >
            <div>
              <div className="logo-font text-xl font-extrabold tracking-tight">Codemm</div>
            </div>
          </Link>



          <div className="flex items-center gap-3">
            <button
              onClick={toggleDarkMode}
              className={`flex h-10 w-10 items-center justify-center rounded-full bg-transparent text-base transition ${
                darkMode ? "text-slate-200 hover:text-white" : "text-slate-600 hover:text-slate-900"
              }`}
              aria-label="Toggle dark mode"
            >
              {darkMode ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              )}
            </button>
            {user ? (
              <button
                onClick={() => router.push("/profile")}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  darkMode ? "bg-transparent text-slate-200 hover:text-white" : "bg-transparent text-slate-700 hover:text-slate-900"
                }`}
              >
                {displayName}
              </button>
            ) : (
              <button
                onClick={() => router.push("/auth/login")}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  darkMode ? "bg-transparent text-slate-200 hover:text-white" : "bg-transparent text-slate-700 hover:text-slate-900"
                }`}
              >
                Log in
              </button>
            )}
          </div>
        </header>

        <main
          className={`flex flex-1 flex-col justify-start gap-4 ${
            isPromptExpanded ? "pt-4 sm:pt-6" : "py-8"
          } ${isPromptExpanded ? "text-left" : "text-center"} transition-all duration-300`}
        >
          {!isPromptExpanded && (
            <div className="flex flex-col items-center gap-4 transition-all duration-300 opacity-100 translate-y-0">
              <p className={`text-base font-semibold ${darkMode ? "text-sky-200" : "text-sky-600"}`}>Your AI</p>
              <h1
                className={`text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl ${
                  darkMode ? "text-white" : "text-slate-900"
                }`}
              >
                Coding and Exam Buddy
              </h1>
              <p className={`max-w-3xl text-lg ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                Generate personalized practice problems in seconds. Stop searching, start solving.
              </p>

              <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-sm">
                {(["practice", "guided"] as LearningMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      if (generationLocked) return;
                      if ((messages.length > 0 || specReady) && mode !== learningMode) {
                        const ok = window.confirm(
                          "Switch learning mode? This will start a new session and reset the current chat/spec.",
                        );
                        if (!ok) return;
                      }
                      setLearningMode(mode);
                    }}
                    disabled={generationLocked || isBusy}
                    className={`rounded-full border px-4 py-2 capitalize transition ${
                      learningMode === mode
                        ? "border-sky-500 bg-sky-50 text-sky-700 shadow-sm dark:border-sky-400/70 dark:bg-sky-900/30 dark:text-sky-100"
                        : darkMode
                          ? "border-slate-800 bg-slate-900 text-slate-200 hover:border-slate-700"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {mode === "practice" ? "Practice Mode" : "Guided Mode (Beta)"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <section
            className={`relative w-full max-w-4xl mx-auto text-left transition-all duration-300 ${
              isPromptExpanded ? "mt-2 sm:mt-4 -translate-y-2 sm:-translate-y-3" : "mt-10 translate-y-0"
            }`}
          >
            <div
              className={`rounded-[28px] border shadow-xl backdrop-blur transition-all duration-300 ${
                darkMode ? "border-slate-800 bg-slate-900/70" : "border-slate-200 bg-white/85"
              } ${isPromptExpanded ? "ring-1 ring-slate-200/60 dark:ring-slate-800/60" : ""}`}
            >
              <div
                className={`space-y-3 overflow-y-auto px-5 py-5 ${
                  isPromptExpanded ? "max-h-[65vh] md:max-h-[70vh]" : "max-h-80"
                }`}
              >
                {messages.length === 0 && (
                  <div
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      darkMode ? "border-slate-800 bg-slate-900/60 text-slate-200" : "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    Ask any coding question and Codemm will walk you through it. Start typing below or pick a quick action.
                  </div>
                )}

                {messages.map((m, idx) => (
                  <div key={idx} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                        m.role === "user"
                          ? "bg-slate-900 text-white shadow-sm dark:bg-slate-800"
                          : m.tone === "question"
                            ? darkMode
                              ? "border border-slate-800 bg-slate-900/70 text-slate-100"
                              : "border border-slate-200 bg-white text-slate-900"
                            : m.tone === "hint"
                              ? darkMode
                                ? "border border-amber-700/60 bg-amber-900/30 text-amber-100"
                                : "border border-amber-200 bg-amber-50 text-amber-900"
                              : m.tone === "info"
                                ? darkMode
                                  ? "border border-slate-800 bg-slate-900/60 text-slate-100"
                                  : "border border-blue-100 bg-blue-50 text-slate-900"
                                : darkMode
                                  ? "bg-slate-900/60 text-slate-100"
                                  : "bg-slate-50 text-slate-900"
                      }`}
                    >
                      {m.tone && m.role === "assistant" && (
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-80">
                          {m.tone === "question" ? "Next step" : m.tone === "hint" ? "Tutor hint" : "Note"}
                        </div>
                      )}
                      {m.content}
                      {m.role === "assistant" && m.summary && (
                        <div
                          className={`mt-2 rounded-lg px-3 py-2 text-[11px] whitespace-pre-line ${
                            darkMode ? "bg-slate-950/40 text-slate-200" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">Summary</div>
                          {m.summary}
                          {Array.isArray(m.assumptions) && m.assumptions.length > 0 && (
                            <div className="mt-2 opacity-80">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">Assumptions</div>
                              <div>{m.assumptions.join(" ")}</div>
                            </div>
                          )}
                        </div>
                      )}
                      {loading &&
                        m.role === "assistant" &&
                        m.tone === "info" &&
                        m.content.trim() === "Generating activity... please wait." && (
                          <div className="mt-3 space-y-2">
                            {progressHint && (
                              <div
                                className={`rounded-lg px-3 py-2 text-[11px] ${
                                  darkMode ? "bg-amber-900/30 text-amber-200" : "bg-amber-50 text-amber-900"
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
                                      darkMode ? "bg-rose-900/30 text-rose-200" : "bg-rose-50 text-rose-900"
                                    }`}
                                  >
                                    {progress.error}
                                  </div>
                                )}

                                <div
                                  className={`space-y-2 rounded-xl border p-3 ${
                                    darkMode ? "border-slate-800 bg-slate-950/40" : "border-slate-200 bg-white"
                                  }`}
                                >
                                  {progress.slots.map((p, i) => {
                                    const percent = renderSlotPercent(p);
                                    const active = p.stage !== "queued" && p.stage !== "done" && p.stage !== "failed";
                                    return (
                                      <div key={i} className="space-y-1">
                                        <div className="flex items-center justify-between gap-3 text-[12px]">
                                          <div className={`truncate ${active ? "font-medium" : ""}`}>
                                            Problem {i + 1}/{progress.totalSlots}
                                            {p.difficulty && p.topic
                                              ? ` (${p.difficulty} - ${p.topic})`
                                              : p.difficulty
                                                ? ` (${p.difficulty})`
                                                : ""}
                                          </div>
                                          <div className={`shrink-0 tabular-nums ${active ? "animate-pulse" : "opacity-80"}`}>
                                            {percent}%
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-between gap-3 text-[11px] opacity-80">
                                          <div className={`truncate ${active ? "animate-pulse" : ""}`}>
                                            {renderSlotStatus(p)}
                                          </div>
                                        </div>
                                        <div
                                          className={`h-1.5 w-full overflow-hidden rounded-full ${
                                            darkMode ? "bg-slate-800" : "bg-slate-200"
                                          }`}
                                        >
                                          <div
                                            className={`h-full rounded-full transition-[width] duration-300 ${
                                              p.stage === "failed" ? "bg-rose-500" : "bg-emerald-500"
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
                              <div className="text-[11px] opacity-70">Waiting for progress events.</div>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex justify-start">
                    <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 ${darkMode ? "bg-slate-900/60" : "bg-slate-100"}`}>
                      <span
                        className={`h-1.5 w-1.5 animate-bounce rounded-full ${darkMode ? "bg-slate-500" : "bg-slate-400"}`}
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className={`h-1.5 w-1.5 animate-bounce rounded-full ${darkMode ? "bg-slate-500" : "bg-slate-400"}`}
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className={`h-1.5 w-1.5 animate-bounce rounded-full ${darkMode ? "bg-slate-500" : "bg-slate-400"}`}
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div
                className={`rounded-b-[28px] px-5 py-4 ${
                  darkMode ? "border-slate-800" : "border-slate-200"
                }`}
              >
                <textarea
                className={`w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-1 ${
                    darkMode
                      ? "border-slate-800 bg-slate-900 text-slate-100 placeholder-slate-500 focus:border-sky-400 focus:ring-sky-400"
                      : "border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:ring-sky-500"
                  }`}
                  placeholder="Start solving..."
                  rows={3}
                  value={chatInput}
                  onChange={(e) => {
                    const next = e.target.value;
                    setChatInput(next);
                    if (next.trim().length > 0) setHasInteracted(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (chatInput.trim()) {
                        setHasInteracted(true);
                        handleChatSend();
                      }
                    }
                  }}
                  disabled={isBusy || specReady}
                />

                <div className="mt-3 flex flex-col items-end gap-3 sm:flex-row sm:items-center sm:justify-end">
                  

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleGenerate}
                      disabled={!specReady || isBusy}
                      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
                        darkMode
                          ? "bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800"
                          : "bg-slate-900 hover:bg-black disabled:bg-slate-300"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {loading ? "Generating..." : "Generate"}
                    </button>
                    <button
                      onClick={handleChatSend}
                      disabled={chatLoading || !chatInput.trim() || specReady}
                      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
                        darkMode
                          ? "bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800"
                          : "bg-slate-900 hover:bg-black disabled:bg-slate-300"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <svg className="h-4 w-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      Send
                    </button>
                  </div>
                </div>
                {specReady && (
                  <div
                    className={`mt-3 rounded-lg px-4 py-2 text-xs ${
                      darkMode ? "bg-emerald-900/30 texAt-emerald-200" : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    Activity spec is ready. Click "Generate" to create problems.
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
