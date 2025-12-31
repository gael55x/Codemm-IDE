import type { CompletionOpts, CompletionResult } from "../types";

// Default to a broadly available model (free keys often lack access to Pro).
const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

function getGeminiApiKey(): string | null {
  const k = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

type GeminiModelInfo = {
  name?: string;
  supportedGenerationMethods?: string[];
};

function normalizeGeminiModelName(name: string): string {
  const s = String(name ?? "").trim();
  return s.startsWith("models/") ? s.slice("models/".length) : s;
}

function looksLikeModelNotFound(status: number, raw: string): boolean {
  if (status === 404) return true;
  const msg = String(raw ?? "");
  return /models\/.+ is not found|not supported for generateContent|call listmodels/i.test(msg);
}

function pickSupportedModelFromList(models: GeminiModelInfo[], preferred: string[]): string | null {
  const supported = models
    .map((m) => ({
      name: typeof m?.name === "string" ? normalizeGeminiModelName(m.name) : "",
      methods: Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [],
    }))
    .filter((m) => Boolean(m.name) && m.methods.includes("generateContent"))
    .map((m) => m.name);

  if (supported.length === 0) return null;

  const preferredNormalized = preferred.map(normalizeGeminiModelName);
  for (const want of preferredNormalized) {
    if (supported.includes(want)) return want;
  }

  // Heuristic: prefer flash models, then the lexicographically earliest stable pick.
  const flash = supported.filter((m) => /\bflash\b/i.test(m));
  if (flash.length) return flash.sort((a, b) => a.localeCompare(b))[0]!;
  return supported.sort((a, b) => a.localeCompare(b))[0]!;
}

export async function createGeminiCompletion(
  opts: CompletionOpts,
  auth?: { apiKey?: string; baseURL?: string }
): Promise<CompletionResult> {
  const apiKey = auth?.apiKey ?? getGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set in the environment.");
  const apiKeyStr = apiKey;

  const baseURL = (auth?.baseURL ?? process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/+$/,
    ""
  );
  const preferredModel = opts.model ?? process.env.GEMINI_MODEL ?? process.env.CODEX_MODEL ?? DEFAULT_GEMINI_MODEL;

  // Conservative: combine system + user to avoid API/version quirks around system instruction fields.
  const prompt = `${opts.system}\n\n${opts.user}`.trim();

  async function requestOnce(model: string): Promise<{ status: number; raw: string }> {
    const url = `${baseURL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKeyStr)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.3,
          maxOutputTokens: opts.maxTokens ?? 5000,
        },
      }),
    });
    return { status: res.status, raw: await res.text() };
  }

  async function listModels(): Promise<GeminiModelInfo[]> {
    const url = `${baseURL}/models?key=${encodeURIComponent(apiKeyStr)}`;
    const res = await fetch(url, { method: "GET" });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Gemini ListModels error (${res.status}): ${raw.slice(0, 800)}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Gemini ListModels returned non-JSON: ${raw.slice(0, 800)}`);
    }
    return Array.isArray(parsed?.models) ? (parsed.models as GeminiModelInfo[]) : [];
  }

  // Some free-tier keys don't have access to Pro models. If the preferred model isn't supported,
  // retry with Flash; if that still fails, use ListModels to find a supported generateContent model.
  let finalRaw: string;
  let finalStatus: number;
  const tried = new Set<string>();

  const firstModel = normalizeGeminiModelName(preferredModel);
  tried.add(firstModel);
  const first = await requestOnce(firstModel);
  finalRaw = first.raw;
  finalStatus = first.status;

  if (looksLikeModelNotFound(finalStatus, finalRaw)) {
    const flash = normalizeGeminiModelName(DEFAULT_GEMINI_MODEL);
    if (!tried.has(flash)) {
      tried.add(flash);
      const retry = await requestOnce(flash);
      finalRaw = retry.raw;
      finalStatus = retry.status;
    }
  }

  if (looksLikeModelNotFound(finalStatus, finalRaw)) {
    const models = await listModels();
    const picked = pickSupportedModelFromList(models, [
      DEFAULT_GEMINI_MODEL,
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro",
    ]);
    if (picked && !tried.has(picked)) {
      tried.add(picked);
      const retry = await requestOnce(picked);
      finalRaw = retry.raw;
      finalStatus = retry.status;
    }
  }

  if (finalStatus < 200 || finalStatus >= 300) {
    throw new Error(`Gemini API error (${finalStatus}): ${finalRaw.slice(0, 800)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(finalRaw);
  } catch {
    throw new Error(`Gemini API returned non-JSON: ${finalRaw.slice(0, 800)}`);
  }

  const parts = parsed?.candidates?.[0]?.content?.parts;
  const text =
    Array.isArray(parts)
      ? parts
          .map((p: any) => (p && typeof p.text === "string" ? p.text : ""))
          .join("")
          .trim()
      : "";

  return { content: [{ type: "text", text }] };
}
