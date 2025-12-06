import { GeneratedProblem } from "./config";
export interface GenerateProblemsRequest {
    count: number;
    prompt?: string;
    validate?: boolean;
    enforceCount?: boolean;
}
export interface GenerateProblemsResponse {
    problems: GeneratedProblem[];
    rawText: string;
}
export declare class ProblemAgent {
    generateProblems({ count, prompt, validate, enforceCount, }: GenerateProblemsRequest): Promise<GenerateProblemsResponse>;
    private parseAndValidate;
    private tryParseJson;
    private buildDefaultClassSkeleton;
    private buildDefaultTestSuite;
}
//# sourceMappingURL=agent.d.ts.map