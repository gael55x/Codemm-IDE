"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSingleProblem = generateSingleProblem;
const crypto_1 = __importDefault(require("crypto"));
const anthropic_1 = require("../infra/llm/anthropic");
const jsonParser_1 = require("../utils/jsonParser");
const javaCodegen_1 = require("../utils/javaCodegen");
const javaRules_1 = require("../contracts/javaRules");
const problem_1 = require("../contracts/problem");
const prompts_1 = require("./prompts");
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";
/**
 * Generate a single problem for the given slot via one Anthropic LLM call.
 *
 * Returns GeneratedProblemDraft (includes reference_solution).
 * Validates JSON shape and test suite structure.
 * Does NOT validate reference solution via Docker (that's the next step).
 * Does NOT retry (caller handles retries).
 *
 * Throws on any validation failure.
 */
async function generateSingleProblem(slot) {
    const anthropic = (0, anthropic_1.getAnthropicClient)();
    const prompt = (0, prompts_1.buildSlotPrompt)(slot);
    const completion = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 5000,
        temperature: 0.3,
        system: prompts_1.V1_PROBLEM_GENERATOR_SYSTEM_PROMPT,
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],
    });
    const text = completion.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n");
    // Parse JSON (reuse legacy robust parser)
    const parsed = (0, jsonParser_1.tryParseJson)(text);
    if (!parsed || typeof parsed !== "object") {
        throw new Error("LLM response is not a valid JSON object.");
    }
    // Normalize fields (defensive, same pattern as legacy agent)
    const raw = parsed;
    const baseId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto_1.default.randomUUID();
    const title = typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : `Problem for ${slot.topics[0] ?? "Java"}`;
    const description = typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : `Problem description for ${title}.`;
    let starterCode = typeof raw.starter_code === "string" && raw.starter_code.trim() ? raw.starter_code.trim() : "";
    // Infer class name from starter_code
    let className = (0, javaCodegen_1.inferClassName)(starterCode, `Problem${slot.index + 1}`);
    // If starter_code missing or has package, synthesize
    if (!starterCode.trim() || /^\s*package\s+/m.test(starterCode)) {
        starterCode = (0, javaCodegen_1.buildDefaultClassSkeleton)(className);
        className = (0, javaCodegen_1.inferClassName)(starterCode, `Problem${slot.index + 1}`);
    }
    let testSuite = typeof raw.test_suite === "string" && raw.test_suite.trim() ? raw.test_suite.trim() : "";
    // Validate test suite structure strictly
    if (!(0, javaRules_1.isValidJUnit5TestSuite)(testSuite, 8)) {
        throw new Error(`Invalid test_suite for slot ${slot.index}: must have exactly 8 @Test methods, JUnit 5 imports, no package, and non-trivial assertions.`);
    }
    // Ensure test suite references the class
    const referencesClass = new RegExp(`\\b${className}\\b`).test(testSuite);
    if (!referencesClass) {
        throw new Error(`Test suite for slot ${slot.index} does not reference class "${className}".`);
    }
    let referenceSolution = typeof raw.reference_solution === "string" && raw.reference_solution.trim()
        ? raw.reference_solution.trim()
        : "";
    if (!referenceSolution.trim()) {
        throw new Error(`Missing reference_solution for slot ${slot.index}.`);
    }
    // Ensure reference solution has no package
    if (/^\s*package\s+/m.test(referenceSolution)) {
        throw new Error(`reference_solution for slot ${slot.index} contains package declaration.`);
    }
    // Ensure reference solution matches class name
    const refClassName = (0, javaCodegen_1.inferClassName)(referenceSolution, "");
    if (refClassName !== className) {
        throw new Error(`reference_solution class name "${refClassName}" does not match starter_code class name "${className}".`);
    }
    const constraints = typeof raw.constraints === "string" && raw.constraints.trim()
        ? raw.constraints.trim()
        : slot.constraints;
    const sampleInputs = Array.isArray(raw.sample_inputs)
        ? raw.sample_inputs
        : [];
    const sampleOutputs = Array.isArray(raw.sample_outputs)
        ? raw.sample_outputs
        : [];
    const difficulty = slot.difficulty;
    const topicTag = slot.topics[0] ?? "oop";
    const draft = {
        id: baseId,
        title,
        description,
        starter_code: starterCode,
        test_suite: testSuite,
        reference_solution: referenceSolution,
        constraints,
        sample_inputs: sampleInputs,
        sample_outputs: sampleOutputs,
        difficulty,
        topic_tag: topicTag,
    };
    // Validate against GeneratedProblemDraftSchema
    const result = problem_1.GeneratedProblemDraftSchema.safeParse(draft);
    if (!result.success) {
        const firstError = result.error.issues[0];
        throw new Error(`Generated problem for slot ${slot.index} failed schema validation: ${firstError?.message ?? "unknown error"}`);
    }
    return result.data;
}
//# sourceMappingURL=perSlotGenerator.js.map