"use client";

import { useEffect, useState } from "react";
import { useThemeMode } from "@/lib/useThemeMode";

type LlmProvider = "openai" | "anthropic" | "gemini" | "ollama";

type LlmSettingsResponse = {
  configured: boolean;
  provider: string | null;
  model?: string | null;
  updatedAt: string | null;
};

type OllamaStatus = {
  installed: boolean;
  running: boolean;
  version: string | null;
  baseURL: string;
  model: string | null;
  modelPresent: boolean | null;
  models: string[] | null;
  error: string | null;
};

export default function LlmSettingsPage() {
  const { darkMode } = useThemeMode();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [ollamaEnsuring, setOllamaEnsuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LlmSettingsResponse | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [ollamaLog, setOllamaLog] = useState<string>("");

  const [provider, setProvider] = useState<LlmProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const api = (window as any)?.codemm?.secrets;
        if (!api || typeof api.getLlmSettings !== "function") {
          setStatus({
            configured: false,
            provider: null,
            updatedAt: null,
          });
          setError("IDE bridge unavailable. Launch this screen inside Codemm-Desktop.");
          return;
        }

        const data = (await api.getLlmSettings()) as LlmSettingsResponse;
        setStatus(data);

        const p = String(data.provider || "").toLowerCase();
        if (p === "openai" || p === "anthropic" || p === "gemini" || p === "ollama") {
          setProvider(p);
        }
        const m = typeof (data as any).model === "string" ? String((data as any).model) : "";
        setModel(m);
      } catch (e: any) {
        setError(e?.message || "Failed to load LLM settings");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  async function refreshOllamaStatus(nextModel?: string) {
    const api = (window as any)?.codemm?.ollama;
    if (!api || typeof api.getStatus !== "function") return;
    setOllamaChecking(true);
    try {
      const st = (await api.getStatus({ model: typeof nextModel === "string" ? nextModel : model })) as OllamaStatus;
      setOllamaStatus(st);
    } catch (e: any) {
      setOllamaStatus({
        installed: false,
        running: false,
        version: null,
        baseURL: "http://127.0.0.1:11434",
        model: typeof nextModel === "string" ? nextModel : model,
        modelPresent: null,
        models: null,
        error: e?.message || "Failed to check Ollama",
      });
    } finally {
      setOllamaChecking(false);
    }
  }

  async function ensureOllamaAndPull() {
    const api = (window as any)?.codemm?.ollama;
    if (!api || typeof api.ensure !== "function") {
      setError("IDE bridge unavailable. Launch this screen inside Codemm-Desktop.");
      return;
    }
    setError(null);
    setOllamaLog("");
    setOllamaEnsuring(true);
    try {
      const res = await api.ensure({
        model,
        onEvent: (ev: any) => {
          const t = typeof ev?.type === "string" ? ev.type : "event";
          const msg =
            t === "log"
              ? String(ev?.text || "")
              : t === "status"
                ? String(ev?.message || "")
                : t === "error"
                  ? `ERROR: ${String(ev?.message || "")}`
                  : t === "done"
                    ? `DONE (code=${String(ev?.code ?? "null")})`
                    : JSON.stringify(ev);
          if (!msg) return;
          setOllamaLog((prev) => {
            const next = `${prev}${prev ? "\n" : ""}${msg}`.slice(-20_000);
            return next;
          });
        },
      });
      if (res && res.ok === false && res.reason === "OLLAMA_NOT_INSTALLED") {
        setError("Ollama is not installed. Click Install Ollama, then try again.");
        return;
      }
      await refreshOllamaStatus(model);
    } catch (e: any) {
      setError(e?.message || "Failed to ensure Ollama");
    } finally {
      setOllamaEnsuring(false);
    }
  }

  async function save() {
    const api = (window as any)?.codemm?.secrets;
    if (!api || typeof api.setLlmSettings !== "function") {
      setError("IDE bridge unavailable. Launch this screen inside Codemm-Desktop.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (provider === "ollama") {
        await api.setLlmSettings({ provider, model });
        // Best-effort: make Ollama immediately usable for users without an API key.
        await ensureOllamaAndPull();
      } else {
        await api.setLlmSettings({ provider, apiKey });
      }
      setApiKey("");
      const refreshed = (await api.getLlmSettings()) as LlmSettingsResponse;
      setStatus(refreshed);
    } catch (e: any) {
      setError(e?.message || "Failed to save LLM settings");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    const api = (window as any)?.codemm?.secrets;
    if (!api || typeof api.clearLlmSettings !== "function") {
      setError("IDE bridge unavailable. Launch this screen inside Codemm-Desktop.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.clearLlmSettings();
      setApiKey("");
      setStatus({ configured: false, provider: null, updatedAt: null });
    } catch (e: any) {
      setError(e?.message || "Failed to clear LLM settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`min-h-screen transition-colors ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`}>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">LLM Settings</h1>
            <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
              Use your own API key (cloud providers) or run a local model via Ollama. Keys are stored locally and are never shown back in the UI.
            </p>
          </div>
          <button
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              darkMode ? "bg-slate-800 hover:bg-slate-700" : "bg-slate-100 hover:bg-slate-200"
            }`}
            onClick={() => history.back()}
          >
            Back
          </button>
        </div>

        <div className={`mt-8 rounded-2xl border p-5 ${darkMode ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
          {loading ? (
            <div className={darkMode ? "text-slate-300" : "text-slate-600"}>Loading…</div>
          ) : (
            <>
              {error ? (
                <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${darkMode ? "bg-rose-950 text-rose-200" : "bg-rose-50 text-rose-700"}`}>
                  {error}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={`block text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Provider</label>
                  <select
                    className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm ${
                      darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900"
                    }`}
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as LlmProvider)}
                    disabled={saving}
                  >
                    <option value="openai">OpenAI / OpenAI-compatible</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                    <option value="ollama">Ollama (local)</option>
                  </select>
                  <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    This is stored locally and used for generation.
                  </p>
                </div>

                <div>
                  {provider === "ollama" ? (
                    <>
                      <label className={`block text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Model</label>
                      <input
                        className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm ${
                          darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900"
                        }`}
                        placeholder='Example: "qwen2.5-coder:7b"'
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={saving}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                            darkMode ? "bg-slate-800 hover:bg-slate-700" : "bg-slate-100 hover:bg-slate-200"
                          } ${ollamaChecking ? "opacity-60" : ""}`}
                          onClick={() => refreshOllamaStatus(model)}
                          disabled={ollamaChecking || saving || !model.trim()}
                        >
                          {ollamaChecking ? "Checking…" : "Check Ollama"}
                        </button>
                        <button
                          className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                            darkMode ? "bg-emerald-700 hover:bg-emerald-600 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white"
                          } ${ollamaEnsuring ? "opacity-60" : ""}`}
                          onClick={ensureOllamaAndPull}
                          disabled={ollamaEnsuring || saving || !model.trim()}
                        >
                          {ollamaEnsuring ? "Ensuring…" : "Ensure + pull model"}
                        </button>
                        <button
                          className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                            darkMode ? "bg-slate-800 hover:bg-slate-700" : "bg-slate-100 hover:bg-slate-200"
                          }`}
                          onClick={async () => {
                            const ollama = (window as any)?.codemm?.ollama;
                            if (ollama?.openInstall) await ollama.openInstall();
                          }}
                          disabled={saving}
                        >
                          Install Ollama
                        </button>
                      </div>

                      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${darkMode ? "border-slate-800 bg-slate-950 text-slate-300" : "border-slate-200 bg-white text-slate-600"}`}>
                        <div>
                          {ollamaStatus ? (
                            <>
                              <div>Server: {ollamaStatus.running ? `running (${ollamaStatus.baseURL})` : `not running (${ollamaStatus.baseURL})`}</div>
                              <div>Installed: {ollamaStatus.installed ? "yes" : "no"}</div>
                              <div>Model: {model.trim() ? (ollamaStatus.modelPresent ? "present" : "missing") : "not set"}</div>
                              {ollamaStatus.version ? <div>Version: {ollamaStatus.version}</div> : null}
                              {ollamaStatus.error ? <div className={darkMode ? "text-rose-300" : "text-rose-700"}>Note: {ollamaStatus.error}</div> : null}
                            </>
                          ) : (
                            <div>Tip: Click “Check Ollama” to verify the server and model are ready.</div>
                          )}
                        </div>
                        {ollamaLog ? (
                          <pre className={`mt-2 max-h-40 overflow-auto rounded-md p-2 ${darkMode ? "bg-slate-900 text-slate-200" : "bg-slate-50 text-slate-800"}`}>
                            {ollamaLog}
                          </pre>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <label className={`block text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>API Key</label>
                      <input
                        className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm ${
                          darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900"
                        }`}
                        type="password"
                        placeholder={status?.configured ? "••••••••••••••••" : "paste your key here"}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        disabled={saving}
                      />
                      <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                        Leaving this blank won’t change anything. To update, paste a new key and Save.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    darkMode ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  } ${saving ? "opacity-60" : ""}`}
                  onClick={save}
                  disabled={saving || (provider === "ollama" ? !model.trim() : !apiKey.trim())}
                >
                  {saving ? "Saving…" : provider === "ollama" ? "Save model" : "Save key"}
                </button>
                <button
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    darkMode ? "bg-slate-800 hover:bg-slate-700" : "bg-slate-100 hover:bg-slate-200"
                  } ${saving ? "opacity-60" : ""}`}
                  onClick={clearKey}
                  disabled={saving || !status?.configured}
                >
                  Clear
                </button>
                <div className={`ml-auto text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                  {status?.configured ? `Configured (${status.provider})` : "Not configured"}
                  {status?.updatedAt ? ` • updated ${new Date(status.updatedAt).toLocaleString()}` : ""}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
