import {
  CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE,
  CODEMM_DEFAULT_TEST_CASE_COUNT,
} from "../contracts/activitySpec";
import type { LanguageProfile } from "./types";

export const CPP_LANGUAGE_PROFILE: LanguageProfile = {
  language: "cpp",
  displayName: "C++",
  runtime: "C++20 (g++)",
  testFramework: "custom",
  defaultConstraints: CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE.cpp,
  defaultTestCaseCount: CODEMM_DEFAULT_TEST_CASE_COUNT,
  // We'll flip these on once adapters + Docker judge are wired.
  support: { execution: false, judge: false, generation: false },
  promptHints: ["C++20", "exactly 8 tests named test_case_1..test_case_8", "no filesystem/networking"],
};

