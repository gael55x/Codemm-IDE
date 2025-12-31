import type { CompletionOpts, CompletionResult, LlmProvider } from "./types";
import { createAnthropicCompletion, hasAnthropicApiKey } from "./adapters/anthropic";
import { createGeminiCompletion, hasGeminiApiKey } from "./adapters/gemini";
import { createOpenAiCompletion, hasOpenAiApiKey, getOpenAiClient } from "./adapters/openai";
import { getTraceContext } from "../../utils/traceContext";
import { userDb } from "../../database";
import { decryptSecret } from "../../utils/secretBox";

function normalizeProvider(raw: unknown): LlmProvider | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "openai" || s === "oai") return "openai";
  if (s === "anthropic" || s === "claude") return "anthropic";
  if (s === "gemini" || s === "google") return "gemini";
  if (s === "auto") return null;
  return null;
}

function getConfiguredProvider(): LlmProvider | null {
  const raw = process.env.CODEX_PROVIDER ?? process.env.CODEMM_LLM_PROVIDER;
  return normalizeProvider(raw);
}

export function hasAnyLlmApiKey(): boolean {
  if (hasOpenAiApiKey() || hasAnthropicApiKey() || hasGeminiApiKey()) return true;
  const userId = getTraceContext()?.userId;
  if (typeof userId !== "number") return false;
  const cfg = userDb.getLlmConfig(userId);
  return Boolean(cfg?.llm_provider && cfg?.llm_api_key_enc);
}

function getUserLlmOverride(): { provider: LlmProvider; apiKey: string } | null {
  const userId = getTraceContext()?.userId;
  if (typeof userId !== "number") return null;

  const cfg = userDb.getLlmConfig(userId);
  if (!cfg || !cfg.llm_provider || !cfg.llm_api_key_enc) return null;

  const provider = normalizeProvider(cfg.llm_provider);
  if (!provider) return null;

  try {
    const apiKey = decryptSecret(cfg.llm_api_key_enc).trim();
    if (!apiKey) return null;
    return { provider, apiKey };
  } catch (err: any) {
    throw new Error(
      `Stored LLM API key could not be decrypted. Re-save your key in settings. (${err?.message ?? "decrypt failed"})`
    );
  }
}

function resolveProviderOrThrow(): LlmProvider {
  const explicit = getConfiguredProvider();
  if (explicit === "openai") {
    if (!hasOpenAiApiKey()) {
      throw new Error(
        "Missing OpenAI API key. Set CODEX_API_KEY or OPENAI_API_KEY, or set CODEX_PROVIDER=anthropic|gemini."
      );
    }
    return "openai";
  }
  if (explicit === "anthropic") {
    if (!hasAnthropicApiKey()) {
      throw new Error("Missing Anthropic API key. Set ANTHROPIC_API_KEY, or set CODEX_PROVIDER=openai|gemini.");
    }
    return "anthropic";
  }
  if (explicit === "gemini") {
    if (!hasGeminiApiKey()) {
      throw new Error("Missing Gemini API key. Set GEMINI_API_KEY/GOOGLE_API_KEY, or set CODEX_PROVIDER=openai|anthropic.");
    }
    return "gemini";
  }

  // Auto mode: choose the first available provider (one provider per process).
  if (hasOpenAiApiKey()) return "openai";
  if (hasAnthropicApiKey()) return "anthropic";
  if (hasGeminiApiKey()) return "gemini";

  throw new Error(
    "No LLM API key found. Set one of: CODEX_API_KEY/OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY."
  );
}

export async function createCodemmCompletion(opts: CompletionOpts): Promise<CompletionResult> {
  const userOverride = getUserLlmOverride();
  if (userOverride) {
    if (userOverride.provider === "openai") return createOpenAiCompletion(opts, { apiKey: userOverride.apiKey });
    if (userOverride.provider === "anthropic") return createAnthropicCompletion(opts, { apiKey: userOverride.apiKey });
    return createGeminiCompletion(opts, { apiKey: userOverride.apiKey });
  }

  const provider = resolveProviderOrThrow();
  if (provider === "openai") return createOpenAiCompletion(opts);
  if (provider === "anthropic") return createAnthropicCompletion(opts);
  return createGeminiCompletion(opts);
}

// Backwards-compatible alias for older call sites.
export const createCodexCompletion = createCodemmCompletion;

// Backwards-compatible export for older code that directly asked for an OpenAI client.
export const getCodexClient = getOpenAiClient;
