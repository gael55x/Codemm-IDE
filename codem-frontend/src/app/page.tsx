"use client";

import { useState, useEffect } from "react";
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
  const [darkMode, setDarkMode] = useState(false);
  const [user, setUser] = useState<any>(null);

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

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("codem-theme", newMode ? "dark" : "light");
  };

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
    const token = localStorage.getItem("codem-token");
    if (!token) {
      router.push("/auth/login");
      return;
    }

    setLoading(true);
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    try {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Generating activity... please wait.",
        },
      ]);
      const res = await fetch(`${BACKEND_URL}/activities`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: lastAssistant?.content ?? chatInput,
        }),
      });
      const data = await res.json();
      if (typeof data.activityId === "string") {
        router.push(`/activity/${data.activityId}`);
      } else if (data?.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Failed to generate activity: ${data.error} ${data.detail ?? ""}` },
        ]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const isBusy = chatLoading || loading;

  const presetPrompts = [
    "Give me 5 beginner OOP problems on encapsulation with stdout checks.",
    "Create 5 intermediate problems on inheritance and polymorphism; include sample I/O.",
    "Generate 5 array/string parsing problems with printf-style outputs and unit tests.",
  ];

  return (
    <div className={`min-h-screen transition-colors ${darkMode ? "bg-slate-900" : "bg-white"}`}>
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8">
        {/* Clean Apple-style header */}
        <header className={`mb-8 flex items-center justify-between border-b pb-6 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          <div>
            <h1 className={`text-3xl font-semibold tracking-tight ${darkMode ? "text-white" : "text-slate-900"}`}>
              Codem
            </h1>
            <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
              AI Java OOP Tutor
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
                {user.displayName}
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
                disabled={messages.length === 0}
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
                  What would you like to create?
                </h2>
                <p className={`mb-6 max-w-md text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                  Describe the Java OOP problems you want. Codem will generate a complete activity with class skeletons and JUnit tests.
                </p>
                {/* Quick start buttons */}
                <div className="flex flex-wrap justify-center gap-2">
                  {presetPrompts.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setChatInput(p)}
                      className={`rounded-lg border px-4 py-2 text-xs transition ${
                        darkMode 
                          ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700" 
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {p.length > 60 ? p.slice(0, 60) + "..." : p}
                    </button>
                  ))}
                </div>
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
                  className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-blue-500 text-white shadow-sm"
                      : darkMode 
                        ? "bg-slate-800 text-slate-100" 
                        : "bg-slate-100 text-slate-900"
                  }`}
                >
                  {m.content}
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
                  placeholder="Describe your activity..."
                  rows={3}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (chatInput.trim()) handleChatSend();
                    }
                  }}
                />
              </div>
              <button
                onClick={handleChatSend}
                disabled={chatLoading || !chatInput.trim()}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

