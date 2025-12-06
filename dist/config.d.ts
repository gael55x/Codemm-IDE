export declare const CLAUDE_MODEL: string;
export declare const PROBLEM_AGENT_SYSTEM_PROMPT = "\nYou are an autonomous AI generator responsible for producing high-quality, CodeChum-style Java OOP programming activities. \n\nEach activity must be solvable using Java 17 and must run inside a Docker-based Java compiler environment with JUnit 5.\n\nYour role is to produce:\n\n1. A set of Java OOP programming problems.\n2. Each problem\u2019s full problem statement.\n3. Each problem\u2019s expected class skeleton and method signatures.\n4. A complete JUnit 5 test suite (8 test cases per problem) that will be executed inside a Java 17 Docker container.\n\n[Insert ALL the detailed GLOBAL REQUIREMENTS + RULES + OUTPUT FORMAT + VALIDATION RULES exactly as provided in the original instruction]\n";
export interface GeneratedProblem {
    id: string;
    title: string;
    description: string;
    classSkeleton: string;
    testSuite: string;
    constraints: string;
    sampleInputs: string[];
    sampleOutputs: string[];
}
export interface JudgeResult {
    success: boolean;
    passedTests: string[];
    failedTests: string[];
    stdout: string;
    stderr: string;
    executionTimeMs: number;
}
export interface Activity {
    id: string;
    title: string;
    prompt: string;
    problems: GeneratedProblem[];
    createdAt: string;
}
export declare const STRUCTURED_JSON_INSTRUCTIONS = "\nReturn ONLY valid JSON. Do not include code fences, commentary, or markdown.\nFormat:\n{\n  \"problems\": [\n    {\n      \"id\": \"string-uuid-or-slug\",\n      \"title\": \"string\",\n      \"description\": \"string\",\n      \"classSkeleton\": \"string\",\n      \"testSuite\": \"string\",\n      \"constraints\": \"string\",\n      \"sampleInputs\": [\"string\"],\n      \"sampleOutputs\": [\"string\"]\n    }\n  ]\n}\nEnsure exactly 5 problems. Ensure each testSuite has exactly 8 @Test methods.\nUse JUnit 5 imports (org.junit.jupiter.api.Test and static org.junit.jupiter.api.Assertions.*).\nDo not emit any package declarations. Class names in classSkeleton must match the class under test referenced in the testSuite.\nRespond ONLY with JSON. NO prose, NO markdown, NO extra text.\n";
//# sourceMappingURL=config.d.ts.map