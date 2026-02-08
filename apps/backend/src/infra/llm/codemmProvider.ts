import type { CompletionOpts, CompletionResult, LlmProvider } from "./types";
import { createAnthropicCompletion, hasAnthropicApiKey } from "./adapters/anthropic";
import { createGeminiCompletion, hasGeminiApiKey } from "./adapters/gemini";
import { createOllamaCompletion, hasOllamaModelConfigured } from "./adapters/ollama";
import { createOpenAiCompletion, hasOpenAiApiKey, getOpenAiClient } from "./adapters/openai";

function normalizeProvider(raw: unknown): LlmProvider | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "openai" || s === "oai") return "openai";
  if (s === "anthropic" || s === "claude") return "anthropic";
  if (s === "gemini" || s === "google") return "gemini";
  if (s === "ollama" || s === "local") return "ollama";
  if (s === "auto") return null;
  return null;
}

function getConfiguredProvider(): LlmProvider | null {
  const raw = process.env.CODEX_PROVIDER ?? process.env.CODEMM_LLM_PROVIDER;
  return normalizeProvider(raw);
}

export function hasAnyLlmApiKey(): boolean {
  return hasOpenAiApiKey() || hasAnthropicApiKey() || hasGeminiApiKey();
}

export function hasAnyLlmConfigured(): boolean {
  return hasAnyLlmApiKey() || hasOllamaModelConfigured();
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
  if (explicit === "ollama") {
    if (!hasOllamaModelConfigured()) {
      throw new Error('Missing Ollama model. Set CODEMM_OLLAMA_MODEL (example: "qwen2.5-coder:7b") and ensure Ollama is running.');
    }
    return "ollama";
  }

  // Auto mode: choose the first available provider (one provider per process).
  if (hasOpenAiApiKey()) return "openai";
  if (hasAnthropicApiKey()) return "anthropic";
  if (hasGeminiApiKey()) return "gemini";
  if (hasOllamaModelConfigured()) return "ollama";

  throw new Error(
    'No LLM configured. Set one of: CODEX_API_KEY/OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, or use Ollama by setting CODEX_PROVIDER=ollama and CODEMM_OLLAMA_MODEL.'
  );
}

export async function createCodemmCompletion(opts: CompletionOpts): Promise<CompletionResult> {
  const provider = resolveProviderOrThrow();
  if (provider === "openai") return createOpenAiCompletion(opts);
  if (provider === "anthropic") return createAnthropicCompletion(opts);
  if (provider === "ollama") return createOllamaCompletion(opts);
  return createGeminiCompletion(opts);
}

// Backwards-compatible alias for older call sites.
export const createCodexCompletion = createCodemmCompletion;

// Backwards-compatible export for older code that directly asked for an OpenAI client.
export const getCodexClient = getOpenAiClient;
