import type { GenerationProgressEvent } from "../contracts/generationProgress";
type Listener = (event: GenerationProgressEvent) => void;
export declare function publishGenerationProgress(sessionId: string, event: GenerationProgressEvent): void;
export declare function getGenerationProgressBuffer(sessionId: string): GenerationProgressEvent[];
export declare function subscribeGenerationProgress(sessionId: string, listener: Listener): () => void;
export {};
//# sourceMappingURL=progressBus.d.ts.map