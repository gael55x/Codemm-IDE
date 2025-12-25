function enabled(name: string): boolean {
  return process.env[name] === "1";
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…(truncated, len=${text.length})`;
}

export function isConversationLoggingEnabled(): boolean {
  return enabled("CODEMM_LOG_CONVERSATION");
}

export function logConversationMessage(args: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
}): void {
  if (!isConversationLoggingEnabled()) return;
  const role = args.role.toUpperCase();
  const content = truncate(String(args.content ?? ""), 2000).replace(/\s+/g, " ").trim();
  console.log(`[CODEMM_CHAT] session=${args.sessionId} role=${role} ${content}`);
}

