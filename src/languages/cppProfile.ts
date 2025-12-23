import {
  CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE,
  CODEMM_DEFAULT_TEST_CASE_COUNT,
} from "../contracts/activitySpec";
import type { LanguageProfile } from "./types";
import { cppExecutionAdapter, cppJudgeAdapter } from "./cppAdapters";
import { buildCppSlotPrompt, CPP_V1_GENERATOR_SYSTEM_PROMPT } from "./cppPrompts";

export const CPP_LANGUAGE_PROFILE: LanguageProfile = {
  language: "cpp",
  displayName: "C++",
  runtime: "C++20 (g++)",
  testFramework: "custom",
  defaultConstraints: CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE.cpp,
  defaultTestCaseCount: CODEMM_DEFAULT_TEST_CASE_COUNT,
  support: { execution: true, judge: true, generation: true },
  promptHints: ["C++20", "exactly 8 tests named test_case_1..test_case_8", "no filesystem/networking"],
  executionAdapter: cppExecutionAdapter,
  judgeAdapter: cppJudgeAdapter,
  generator: {
    systemPrompt: CPP_V1_GENERATOR_SYSTEM_PROMPT,
    buildSlotPrompt: buildCppSlotPrompt,
  },
};
