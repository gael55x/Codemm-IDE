"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.truncate = truncate;
exports.trace = trace;
exports.traceText = traceText;
function shouldTrace() {
    return process.env.CODEMM_TRACE === "1";
}
function shouldTraceFull() {
    return process.env.CODEMM_TRACE_FULL === "1";
}
function truncate(text, maxLen) {
    if (text.length <= maxLen)
        return text;
    return `${text.slice(0, maxLen)}…(truncated, len=${text.length})`;
}
function trace(event, data = {}) {
    if (!shouldTrace())
        return;
    const payload = {
        ts: new Date().toISOString(),
        event,
        ...data,
    };
    // Single-line JSON makes it easy to grep.
    console.log(`[CODEMM_TRACE] ${JSON.stringify(payload)}`);
}
function traceText(event, text, opts) {
    if (!shouldTrace())
        return;
    const maxLen = opts?.maxLen ?? (shouldTraceFull() ? 20000 : 2000);
    trace(event, { text: truncate(text, maxLen), ...(opts?.extra ?? {}) });
}
//# sourceMappingURL=trace.js.map