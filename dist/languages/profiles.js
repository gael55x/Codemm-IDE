"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LANGUAGE_PROFILES = void 0;
exports.listAgentSelectableLanguages = listAgentSelectableLanguages;
exports.getLanguageProfile = getLanguageProfile;
exports.isLanguageSupportedForGeneration = isLanguageSupportedForGeneration;
exports.isLanguageSupportedForJudge = isLanguageSupportedForJudge;
exports.isLanguageSupportedForExecution = isLanguageSupportedForExecution;
const activitySpec_1 = require("../contracts/activitySpec");
const javaPrompts_1 = require("./javaPrompts");
const javaAdapters_1 = require("./javaAdapters");
const pythonProfile_1 = require("./pythonProfile");
const cppProfile_1 = require("./cppProfile");
exports.LANGUAGE_PROFILES = {
    java: {
        language: "java",
        displayName: "Java",
        runtime: "Java 17",
        testFramework: "JUnit 5",
        defaultConstraints: activitySpec_1.CODEMM_DEFAULT_CONSTRAINTS_BY_LANGUAGE.java,
        defaultTestCaseCount: activitySpec_1.CODEMM_DEFAULT_TEST_CASE_COUNT,
        support: { execution: true, judge: true, generation: true },
        promptHints: ["No package declarations.", "JUnit 5 (exactly 8 @Test methods)."],
        executionAdapter: javaAdapters_1.javaExecutionAdapter,
        judgeAdapter: javaAdapters_1.javaJudgeAdapter,
        generator: {
            systemPrompt: javaPrompts_1.JAVA_V1_GENERATOR_SYSTEM_PROMPT,
            buildSlotPrompt: javaPrompts_1.buildJavaSlotPrompt,
        },
    },
    python: pythonProfile_1.PYTHON_LANGUAGE_PROFILE,
    cpp: cppProfile_1.CPP_LANGUAGE_PROFILE,
};
function listAgentSelectableLanguages() {
    // What we allow the agent to select without additional product work.
    // If you want to "turn on" Python later, flip its support flags + add adapters.
    return Object.values(exports.LANGUAGE_PROFILES)
        .filter((p) => p.support.generation && p.support.judge)
        .map((p) => p.language);
}
function getLanguageProfile(language) {
    return exports.LANGUAGE_PROFILES[language];
}
function isLanguageSupportedForGeneration(language) {
    return Boolean(exports.LANGUAGE_PROFILES[language]?.support.generation);
}
function isLanguageSupportedForJudge(language) {
    return Boolean(exports.LANGUAGE_PROFILES[language]?.support.judge);
}
function isLanguageSupportedForExecution(language) {
    return Boolean(exports.LANGUAGE_PROFILES[language]?.support.execution);
}
//# sourceMappingURL=profiles.js.map