import type { SpecDraft } from "../specBuilder/validators";
import type { ConfidenceMap, ReadinessResult } from "./readiness";
export declare function generateNextPrompt(args: {
    spec: SpecDraft;
    readiness: ReadinessResult;
    confidence?: ConfidenceMap | null;
    lastUserMessage: string;
}): string;
//# sourceMappingURL=promptGenerator.d.ts.map