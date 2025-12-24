import { JAVA_LANGUAGE_PROFILE } from "./java/profile";
import { CPP_LANGUAGE_PROFILE } from "./cpp/profile";
import { PYTHON_LANGUAGE_PROFILE } from "./python/profile";
import { SQL_LANGUAGE_PROFILE } from "./sql/profile";
import type { LanguageId, LanguageProfile } from "./types";

export const LANGUAGE_PROFILES: Record<LanguageId, LanguageProfile> = {
  java: JAVA_LANGUAGE_PROFILE,
  python: PYTHON_LANGUAGE_PROFILE,
  cpp: CPP_LANGUAGE_PROFILE,
  sql: SQL_LANGUAGE_PROFILE,
};

export function listAgentSelectableLanguages(): LanguageId[] {
  // What we allow the agent to select without additional product work.
  return Object.values(LANGUAGE_PROFILES)
    .filter((p) => p.support.generation && p.support.judge)
    .map((p) => p.language);
}

export function getLanguageProfile(language: LanguageId): LanguageProfile {
  return LANGUAGE_PROFILES[language];
}

export function isLanguageSupportedForGeneration(language: LanguageId): boolean {
  return Boolean(LANGUAGE_PROFILES[language]?.support.generation);
}

export function isLanguageSupportedForJudge(language: LanguageId): boolean {
  return Boolean(LANGUAGE_PROFILES[language]?.support.judge);
}

export function isLanguageSupportedForExecution(language: LanguageId): boolean {
  return Boolean(LANGUAGE_PROFILES[language]?.support.execution);
}
