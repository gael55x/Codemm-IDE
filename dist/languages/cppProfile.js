"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CPP_LANGUAGE_PROFILE = void 0;
const activitySpec_1 = require("../contracts/activitySpec");
const cppAdapters_1 = require("./cppAdapters");
const cppPrompts_1 = require("./cppPrompts");
exports.CPP_LANGUAGE_PROFILE = {
    language: "cpp",
    displayName: "C++",
    runtime: "C++20 (g++)",
    testFramework: "custom",
    defaultConstraints: activitySpec_1.CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE.cpp,
    defaultTestCaseCount: activitySpec_1.CODEMM_DEFAULT_TEST_CASE_COUNT,
    support: { execution: true, judge: true, generation: true },
    promptHints: ["C++20", "exactly 8 tests named test_case_1..test_case_8", "no filesystem/networking"],
    executionAdapter: cppAdapters_1.cppExecutionAdapter,
    judgeAdapter: cppAdapters_1.cppJudgeAdapter,
    generator: {
        systemPrompt: cppPrompts_1.CPP_V1_GENERATOR_SYSTEM_PROMPT,
        buildSlotPrompt: cppPrompts_1.buildCppSlotPrompt,
    },
};
//# sourceMappingURL=cppProfile.js.map