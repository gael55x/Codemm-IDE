import type { CompletionOpts, CompletionResult } from "../types";

const DEFAULT_GEMINI_MODEL = "gemini-1.5-pro";

function getGeminiApiKey(): string | null {
  const k = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

export async function createGeminiCompletion(
  opts: CompletionOpts,
  auth?: { apiKey?: string; baseURL?: string }
): Promise<CompletionResult> {
  const apiKey = auth?.apiKey ?? getGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set in the environment.");

  const baseURL = (auth?.baseURL ?? process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/+$/,
    ""
  );
  const model = opts.model ?? process.env.GEMINI_MODEL ?? process.env.CODEX_MODEL ?? DEFAULT_GEMINI_MODEL;

  // Conservative: combine system + user to avoid API/version quirks around system instruction fields.
  const prompt = `${opts.system}\n\n${opts.user}`.trim();
  const url = `${baseURL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

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

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API error (${res.status}): ${raw.slice(0, 800)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini API returned non-JSON: ${raw.slice(0, 800)}`);
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
