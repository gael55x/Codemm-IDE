import {
  CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE,
  CODEMM_DEFAULT_TEST_CASE_COUNT,
} from "../contracts/activitySpec";
import { buildJavaSlotPrompt, JAVA_V1_GENERATOR_SYSTEM_PROMPT } from "./javaPrompts";
import { javaExecutionAdapter, javaJudgeAdapter } from "./javaAdapters";
import { PYTHON_LANGUAGE_PROFILE } from "./pythonProfile";
import { CPP_LANGUAGE_PROFILE } from "./cppProfile";
import type { LanguageId, LanguageProfile } from "./types";

export const LANGUAGE_PROFILES: Record<LanguageId, LanguageProfile> = {
  java: {
    language: "java",
    displayName: "Java",
    runtime: "Java 17",
    testFramework: "JUnit 5",
    defaultConstraints: CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE.java,
    defaultTestCaseCount: CODEMM_DEFAULT_TEST_CASE_COUNT,
    support: { execution: true, judge: true, generation: true },
    promptHints: ["No package declarations.", "JUnit 5 (exactly 8 @Test methods)."],
    executionAdapter: javaExecutionAdapter,
    judgeAdapter: javaJudgeAdapter,
    generator: {
      systemPrompt: JAVA_V1_GENERATOR_SYSTEM_PROMPT,
      buildSlotPrompt: buildJavaSlotPrompt,
    },
  },
  python: PYTHON_LANGUAGE_PROFILE,
  cpp: CPP_LANGUAGE_PROFILE,
};

export function listAgentSelectableLanguages(): LanguageId[] {
  // What we allow the agent to select without additional product work.
  // If you want to "turn on" Python later, flip its support flags + add adapters.
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
