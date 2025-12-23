"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CPP_LANGUAGE_PROFILE = void 0;
const activitySpec_1 = require("../contracts/activitySpec");
exports.CPP_LANGUAGE_PROFILE = {
    language: "cpp",
    displayName: "C++",
    runtime: "C++20 (g++)",
    testFramework: "custom",
    defaultConstraints: activitySpec_1.CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE.cpp,
    defaultTestCaseCount: activitySpec_1.CODEMM_DEFAULT_TEST_CASE_COUNT,
    // We'll flip these on once adapters + Docker judge are wired.
    support: { execution: false, judge: false, generation: false },
    promptHints: ["C++20", "exactly 8 tests named test_case_1..test_case_8", "no filesystem/networking"],
};
//# sourceMappingURL=cppProfile.js.map