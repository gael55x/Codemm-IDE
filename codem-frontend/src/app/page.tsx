"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [chatLoading, setChatLoading] = useState(false);

  async function handleChatSend() {
    if (!chatInput.trim()) return;
    const userMessage = chatInput.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput }),
      });
      const data = await res.json();
      const reply =
        typeof data.reply === "string"
          ? data.reply
          : JSON.stringify(data, null, 2);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, something went wrong talking to the ProblemAgent.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleGenerate() {
    setLoading(true);
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    try {
      const res = await fetch(`${BACKEND_URL}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: lastAssistant?.content ?? chatInput,
        }),
      });
      const data = await res.json();
      if (typeof data.activityId === "string") {
        router.push(`/activity/${data.activityId}`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto flex h-screen max-w-5xl flex-col gap-3 px-4 py-4">
        <header className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-slate-950">
              C
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">
                Codem – AI Java OOP Tutor
              </h1>
              <p className="text-[11px] text-slate-400">
                Describe the activity you want. Codem will create a CodeChum-style
                problem set and open it in the activity view.
              </p>
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="hidden rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 md:inline-flex"
          >
            {loading ? "Generating..." : "Generate Activity"}
          </button>
        </header>

        <main className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/80 p-3 shadow-inner">
          <div className="flex-1 space-y-3 overflow-hidden">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Chat
              </h2>
              <span className="rounded-full bg-slate-800 px-3 py-0.5 text-[11px] text-slate-300">
                New activity design
              </span>
            </div>
            <div className="h-full rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex h-full flex-col gap-3">
                <div className="flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
                  {messages.length === 0 && (
                    <div className="mt-4 text-center text-xs text-slate-500">
                      Start by telling Codem what kind of Java OOP problems you
                      want. For example:{" "}
                      <span className="font-semibold text-slate-300">
                        &quot;Give me 5 beginner string tokenizer problems like
                        CodeChum with a 30-minute time limit.&quot;
                      </span>
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
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                          m.role === "user"
                            ? "bg-emerald-500 text-slate-950"
                            : "bg-slate-800 text-slate-50"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t border-slate-800 pt-2">
                  <div className="relative">
                    <textarea
                      className="max-h-28 min-h-[60px] w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-500"
                      placeholder="Message Codem about the activity you want to generate..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-slate-500">
                      Tip: Specify topic, difficulty, number of problems, and
                      time limit.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleChatSend}
                        disabled={chatLoading || !chatInput.trim()}
                        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-900 shadow hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {chatLoading ? "Thinking..." : "Ask Codem"}
                      </button>
                      <button
                        onClick={handleGenerate}
                        disabled={loading}
                        className="inline-flex rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 md:hidden"
                      >
                        {loading ? "Generating..." : "Generate Activity"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

