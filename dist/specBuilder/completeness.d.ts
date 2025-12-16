import { SpecQuestionKey } from "./questions";
import { type SpecDraft } from "./validators";
export type CompletenessResult = {
    complete: boolean;
    missing: string[];
};
export declare function checkAnswerCompleteness(key: SpecQuestionKey, buffer: string[], spec: SpecDraft): CompletenessResult;
//# sourceMappingURL=completeness.d.ts.map