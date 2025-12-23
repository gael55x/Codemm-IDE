import type { ProblemSlot } from "../planner/types";
import type { JudgeResult } from "../types";
export type LanguageId = "java" | "python" | "cpp";
export type ExecutionResult = {
    stdout: string;
    stderr: string;
};
export type ExecutionRequest = {
    kind: "code";
    code: string;
    stdin?: string;
} | {
    kind: "files";
    files: Record<string, string>;
    mainClass?: string;
    stdin?: string;
};
export type JudgeRequest = {
    kind: "code";
    code: string;
    testSuite: string;
} | {
    kind: "files";
    files: Record<string, string>;
    testSuite: string;
};
export type ExecutionAdapter = {
    run: (req: ExecutionRequest) => Promise<ExecutionResult>;
};
export type JudgeAdapter = {
    judge: (req: JudgeRequest) => Promise<JudgeResult>;
};
export type SlotPromptContext = {
    domain?: string;
    avoidDomains?: string[];
    avoidTitles?: string[];
};
export type LanguageProfile = {
    language: LanguageId;
    displayName: string;
    runtime: string;
    testFramework: string;
    defaultConstraints: string;
    defaultTestCaseCount: number;
    support: {
        execution: boolean;
        judge: boolean;
        generation: boolean;
    };
    promptHints: string[];
    executionAdapter?: ExecutionAdapter;
    judgeAdapter?: JudgeAdapter;
    generator?: {
        systemPrompt: string;
        buildSlotPrompt: (slot: ProblemSlot, ctx?: SlotPromptContext) => string;
    };
};
//# sourceMappingURL=types.d.ts.map