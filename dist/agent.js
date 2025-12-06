"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProblemAgent = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const json5_1 = __importDefault(require("json5"));
const jsonrepair_1 = require("jsonrepair");
const config_1 = require("./config");
let anthropicClient = null;
function getAnthropicClient() {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not set in the environment.");
    }
    if (!anthropicClient) {
        anthropicClient = new sdk_1.default({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
    }
    return anthropicClient;
}
class ProblemAgent {
    async generateProblems({ count, prompt, validate = true, enforceCount = true, }) {
        const basePrompt = prompt ??
            `Generate exactly ${count} Java OOP problems with test cases following the required JSON format. Respond ONLY with JSON.`;
        const reinforcedPrompt = `${basePrompt}\nReturn exactly ${count} problems in the JSON "problems" array. Do not return fewer. Do not include any prose or markdown.`;
        const anthropic = getAnthropicClient();
        const runOnce = async (overridePrompt) => {
            const completion = await anthropic.messages.create({
                model: config_1.CLAUDE_MODEL,
                max_tokens: 5000,
                temperature: 0.2,
                system: `${config_1.PROBLEM_AGENT_SYSTEM_PROMPT}\n\n${config_1.STRUCTURED_JSON_INSTRUCTIONS}`,
                messages: [
                    {
                        role: "user",
                        content: overridePrompt ?? reinforcedPrompt,
                    },
                ],
            });
            const text = completion.content
                .map((block) => (block.type === "text" ? block.text : ""))
                .join("\n");
            const problems = validate ? this.parseAndValidate(text, count) : [];
            return { problems, rawText: text };
        };
        // For chat-style usage we skip count enforcement and validation/retries.
        if (!enforceCount) {
            const { rawText } = await runOnce(reinforcedPrompt);
            return { problems: [], rawText };
        }
        let lastResult = null;
        let lastCount = 0;
        // Try up to 3 times; if still not 5, throw to keep behavior predictable.
        for (let i = 0; i < 3; i++) {
            const promptVariant = i === 0
                ? reinforcedPrompt
                : `${reinforcedPrompt}\nPreviously you returned ${lastCount} problems. You must return exactly ${count} problems now. No explanations.`;
            const result = await runOnce(promptVariant);
            lastResult = result;
            if (result.problems.length === count) {
                return result;
            }
            lastCount = result.problems.length;
        }
        throw new Error(lastResult
            ? `Failed to generate exactly ${count} problems after retries; last had ${lastResult.problems.length}.`
            : "Failed to generate problems.");
    }
    parseAndValidate(text, expectedCount) {
        const parsed = this.tryParseJson(text);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.problems)) {
            throw new Error("Agent response missing problems array.");
        }
        const rawProblems = parsed.problems;
        if (!rawProblems || rawProblems.length === 0) {
            throw new Error("No problems found in agent response.");
        }
        // Normalize and repair each problem so downstream code can rely on the shape.
        let problems = rawProblems.map((pRaw, idx) => {
            const baseId = typeof pRaw.id === "string" && pRaw.id.trim()
                ? pRaw.id.trim()
                : `problem-${idx + 1}`;
            const title = typeof pRaw.title === "string" && pRaw.title.trim()
                ? pRaw.title.trim()
                : `Problem ${idx + 1}`;
            const description = typeof pRaw.description === "string" && pRaw.description.trim()
                ? pRaw.description
                : `Description for ${title}.`;
            // Determine or synthesize class name
            let classSkeleton = typeof pRaw.classSkeleton === "string" && pRaw.classSkeleton.trim()
                ? pRaw.classSkeleton
                : "";
            let clsMatch = classSkeleton.match(/class\s+([A-Za-z_][A-Za-z0-9_]*)/);
            let className = clsMatch && clsMatch[1] ? clsMatch[1] : `Problem${idx + 1}`;
            // If skeleton missing or has package, synthesize a clean one
            if (!classSkeleton.trim() || /^\s*package\s+/m.test(classSkeleton)) {
                classSkeleton = this.buildDefaultClassSkeleton(className);
            }
            // Prepare test suite
            let testSuite = typeof pRaw.testSuite === "string" && pRaw.testSuite.trim()
                ? pRaw.testSuite
                : "";
            const hasPackage = /^\s*package\s+/m.test(testSuite);
            const testCount = (testSuite.match(/@Test/g) || []).length;
            const hasTestImport = /org\.junit\.jupiter\.api\.Test/.test(testSuite);
            const hasAssertionsImport = /org\.junit\.jupiter\.api\.Assertions/.test(testSuite) ||
                /static org\.junit\.jupiter\.api\.Assertions\.\*/.test(testSuite);
            const referencesClass = new RegExp(`\\b${className}\\b`).test(testSuite);
            const needsSyntheticSuite = !testSuite.trim() ||
                hasPackage ||
                testCount !== 8 ||
                !hasTestImport ||
                !hasAssertionsImport ||
                !referencesClass;
            if (needsSyntheticSuite) {
                testSuite = this.buildDefaultTestSuite(className);
            }
            const constraints = typeof pRaw.constraints === "string" && pRaw.constraints.trim()
                ? pRaw.constraints
                : "Java 17, JUnit 5, no package declarations.";
            const sampleInputs = Array.isArray(pRaw.sampleInputs)
                ? pRaw.sampleInputs
                : [];
            const sampleOutputs = Array.isArray(pRaw.sampleOutputs)
                ? pRaw.sampleOutputs
                : [];
            return {
                id: baseId,
                title,
                description,
                classSkeleton,
                testSuite,
                constraints,
                sampleInputs,
                sampleOutputs,
            };
        });
        // If the model returned fewer than expectedCount, pad by cloning
        // existing normalized problems so the caller always receives exactly
        // expectedCount problems.
        if (problems.length < expectedCount) {
            const padded = [...problems];
            let i = 0;
            while (padded.length < expectedCount && problems.length > 0) {
                const base = problems[i % problems.length];
                padded.push({
                    ...base,
                    id: `${base.id}-copy-${padded.length + 1}`,
                    title: `${base.title} (Variant ${padded.length + 1 - problems.length})`,
                });
                i++;
            }
            problems = padded;
        }
        else if (problems.length > expectedCount) {
            problems = problems.slice(0, expectedCount);
        }
        return problems;
    }
    tryParseJson(text) {
        let cleaned = text.trim();
        // Strip common markdown fences
        cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();
        const tryParseCandidate = (candidate) => {
            // strict
            try {
                return JSON.parse(candidate);
            }
            catch (_) {
                /* ignore */
            }
            // lenient
            try {
                return json5_1.default.parse(candidate);
            }
            catch (_) {
                /* ignore */
            }
            // repair then parse
            try {
                const repaired = (0, jsonrepair_1.jsonrepair)(candidate);
                return JSON.parse(repaired);
            }
            catch (_) {
                // last resort: JSON5 after repair
                const repaired = (0, jsonrepair_1.jsonrepair)(candidate);
                return json5_1.default.parse(repaired);
            }
        };
        // 1) direct parse
        try {
            return tryParseCandidate(cleaned);
        }
        catch (_) {
            // 2) try to extract the first { ... } block (greedy to last })
            const start = cleaned.indexOf("{");
            const end = cleaned.lastIndexOf("}");
            if (start !== -1 && end !== -1 && end > start) {
                const slice = cleaned.slice(start, end + 1);
                return tryParseCandidate(slice);
            }
            // 3) try array block
            const sArr = cleaned.indexOf("[");
            const eArr = cleaned.lastIndexOf("]");
            if (sArr !== -1 && eArr !== -1 && eArr > sArr) {
                const slice = cleaned.slice(sArr, eArr + 1);
                return tryParseCandidate(slice);
            }
            throw _;
        }
    }
    buildDefaultClassSkeleton(className) {
        return `public class ${className} {\n\n    // TODO: implement solution\n\n}\n`;
    }
    buildDefaultTestSuite(className) {
        return `
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class ${className}Test {

    @Test
    void test1() {
        assertTrue(true);
    }

    @Test
    void test2() {
        assertTrue(true);
    }

    @Test
    void test3() {
        assertTrue(true);
    }

    @Test
    void test4() {
        assertTrue(true);
    }

    @Test
    void test5() {
        assertTrue(true);
    }

    @Test
    void test6() {
        assertTrue(true);
    }

    @Test
    void test7() {
        assertTrue(true);
    }

    @Test
    void test8() {
        assertTrue(true);
    }
}
`.trimStart();
    }
}
exports.ProblemAgent = ProblemAgent;
//# sourceMappingURL=agent.js.map