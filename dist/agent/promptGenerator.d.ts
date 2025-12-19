import type { SpecDraft } from "../compiler/specDraft";
import type { ConfidenceMap, ReadinessResult } from "./readiness";
import type { DialogueUpdate } from "./dialogue";
export declare function generateNextPrompt(args: {
    spec: SpecDraft;
    readiness: ReadinessResult;
    confidence?: ConfidenceMap | null;
    lastUserMessage: string;
    dialogueUpdate?: DialogueUpdate | null;
}): string;
//# sourceMappingURL=promptGenerator.d.ts.map