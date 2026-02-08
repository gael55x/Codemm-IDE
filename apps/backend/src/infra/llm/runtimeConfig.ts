import type { LlmProvider } from "./types";

export type RuntimeLlmConfig = {
  provider: LlmProvider | null;
  apiKey: string | null;
  baseURL: string | null;
  model: string | null;
  updatedAt: string | null;
};

let runtimeConfig: RuntimeLlmConfig = {
  provider: null,
  apiKey: null,
  baseURL: null,
  model: null,
  updatedAt: null,
};

export function getRuntimeLlmConfig(): RuntimeLlmConfig {
  return { ...runtimeConfig };
}

export function setRuntimeLlmConfig(next: Partial<Omit<RuntimeLlmConfig, "updatedAt">> & { updatedAt?: string | null }) {
  const provider =
    typeof next.provider === "string" ? (next.provider as LlmProvider) : next.provider === null ? null : runtimeConfig.provider;
  const apiKey = typeof next.apiKey === "string" ? next.apiKey : next.apiKey === null ? null : runtimeConfig.apiKey;
  const baseURL = typeof next.baseURL === "string" ? next.baseURL : next.baseURL === null ? null : runtimeConfig.baseURL;
  const model = typeof next.model === "string" ? next.model : next.model === null ? null : runtimeConfig.model;
  const updatedAt = typeof next.updatedAt === "string" ? next.updatedAt : next.updatedAt === null ? null : new Date().toISOString();

  runtimeConfig = { provider, apiKey, baseURL, model, updatedAt };
}

