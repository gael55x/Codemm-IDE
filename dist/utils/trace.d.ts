type TraceData = Record<string, unknown>;
export declare function truncate(text: string, maxLen: number): string;
export declare function trace(event: string, data?: TraceData): void;
export declare function traceText(event: string, text: string, opts?: {
    maxLen?: number;
    extra?: TraceData;
}): void;
export {};
//# sourceMappingURL=trace.d.ts.map