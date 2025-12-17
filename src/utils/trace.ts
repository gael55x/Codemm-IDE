type TraceData = Record<string, unknown>;

function shouldTrace(): boolean {
  return process.env.CODEMM_TRACE === "1";
}

function shouldTraceFull(): boolean {
  return process.env.CODEMM_TRACE_FULL === "1";
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…(truncated, len=${text.length})`;
}

export function trace(event: string, data: TraceData = {}): void {
  if (!shouldTrace()) return;
  const payload: TraceData = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  // Single-line JSON makes it easy to grep.
  console.log(`[CODEMM_TRACE] ${JSON.stringify(payload)}`);
}

export function traceText(
  event: string,
  text: string,
  opts?: { maxLen?: number; extra?: TraceData }
): void {
  if (!shouldTrace()) return;
  const maxLen = opts?.maxLen ?? (shouldTraceFull() ? 20000 : 2000);
  trace(event, { text: truncate(text, maxLen), ...(opts?.extra ?? {}) });
}

