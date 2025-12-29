import { z } from "zod";
import type { GeneratedProblemDraft } from "../contracts/problem";
import type { ProblemSlot } from "../planner/types";
import { createCodexCompletion } from "../infra/llm/codex";
import { tryParseJson } from "../utils/jsonParser";
import { trace, traceText } from "../utils/trace";

const GuidedHintsSchema = z
  .object({
    hints: z.array(z.string()).default([]),
  })
  .strict();

function maxHintsForScaffoldLevel(scaffoldLevel: number): number {
  if (scaffoldLevel >= 0.75) return 4;
  if (scaffoldLevel >= 0.45) return 2;
  return 0;
}

function sanitizeHintText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  if (!text) return null;

  text = text.replace(/```[\s\S]*?```/g, " ").trim();
  text = text.replace(/`+/g, "");
  text = text.replace(/^[-*•]\s+/, "");
  text = text.replace(/^hint:\s*/i, "");
  text = text.replace(/^step\s*\d+\s*:\s*/i, "");
  text = text.replace(/\s+/g, " ").trim();

  if (!text) return null;
  if (/BEGIN STUDENT TODO|END STUDENT TODO/i.test(text)) return null;

  // Avoid accidentally emitting code snippets into learner workspaces.
  const looksLikeCode =
    /#include\b|std::|public\s+static\b|class\s+\w+\b|def\s+\w+\s*\(|function\s+\w+\s*\(|=>|\{|\}|;/.test(
      text
    ) || /\bint\s+solve\s*\(/.test(text);
  if (looksLikeCode) return null;

  // Prefer short, actionable hints.
  const MAX_LEN = 160;
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN - 1)}…`;

  return text;
}

function toHintCommentLine(lineComment: string, hint: string): string {
  const trimmed = hint.trim().replace(/\.$/, "");
  return `${lineComment} Hint: ${trimmed}.`;
}

function buildHintsPrompt(args: {
  draft: GeneratedProblemDraft;
  slot: ProblemSlot;
  scaffoldLevel: number;
  maxHints: number;
}): { system: string; user: string } {
  const system =
    "You are a concise programming instructor. " +
    "Return ONLY valid JSON (no markdown, no code fences). " +
    "Never output code. Never output the full solution. " +
    "Hints should be plain English, short (<= 160 chars), and actionable.";

  const topics = Array.isArray(args.slot.topics) ? args.slot.topics : [];
  const learningGoal = (args.slot.pedagogy?.learning_goal ?? "").trim();
  const description = String(args.draft.description ?? "");
  const trimmedDescription = description.length > 1600 ? `${description.slice(0, 1600)}…` : description;

  const user =
    `Generate up to ${args.maxHints} hints for a learner in guided mode.\n` +
    `Language: ${args.draft.language}\n` +
    `Title: ${args.draft.title}\n` +
    `Topics: ${topics.join(", ") || "(none)"}\n` +
    `Learning goal: ${learningGoal || "(none)"}\n` +
    `Scaffold level (0..1): ${args.scaffoldLevel}\n\n` +
    `Problem description:\n${trimmedDescription}\n\n` +
    `Return JSON exactly:\n` +
    `{"hints":["..."]}\n\n` +
    `Rules:\n` +
    `- No code, no pseudo-code, no API signatures.\n` +
    `- Do not reveal full algorithm steps end-to-end.\n` +
    `- Avoid repeating obvious hints like "read the problem".\n` +
    `- Each hint should be a single sentence.\n`;

  return { system, user };
}

export async function generateDynamicGuidedHintLines(args: {
  draft: GeneratedProblemDraft;
  slot: ProblemSlot;
  scaffoldLevel: number;
  lineComment: string;
  deps?: GuidedHintsDeps;
}): Promise<string[]> {
  const hintsEnabled = args.slot.pedagogy?.hints_enabled !== false;
  if (!hintsEnabled) return [];

  const envToggle = process.env.CODEMM_DYNAMIC_GUIDED_HINTS;
  if (envToggle === "0") return [];

  const maxHints = maxHintsForScaffoldLevel(args.scaffoldLevel);
  if (maxHints <= 0) return [];

  // Avoid network calls in tests unless explicitly injected.
  const injectedCompletion = args.deps?.createCompletion;
  if (process.env.NODE_ENV === "test" && !injectedCompletion) return [];

  // If we don't have credentials, skip (best-effort feature).
  if (!process.env.CODEX_API_KEY && !injectedCompletion) return [];

  const { system, user } = buildHintsPrompt({
    draft: args.draft,
    slot: args.slot,
    scaffoldLevel: args.scaffoldLevel,
    maxHints,
  });

  const createCompletion = injectedCompletion ?? createCodexCompletion;
  const completion = await createCompletion({
    system,
    user,
    temperature: 0.2,
    maxTokens: 500,
  });

  const text = completion.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  traceText("generation.guided.hints.raw", text, { extra: { slotIndex: args.slot.index } });

  const parsed = GuidedHintsSchema.safeParse(tryParseJson(text));
  if (!parsed.success) return [];

  const sanitized = parsed.data.hints
    .map((h) => sanitizeHintText(h))
    .filter((h): h is string => typeof h === "string" && h.length > 0)
    .slice(0, maxHints)
    .map((h) => toHintCommentLine(args.lineComment, h));

  trace("generation.guided.hints.generated", {
    slotIndex: args.slot.index,
    scaffoldLevel: args.scaffoldLevel,
    requested: maxHints,
    returned: sanitized.length,
  });

  return sanitized;
}

export type GuidedHintsDeps = { createCompletion?: typeof createCodexCompletion };
