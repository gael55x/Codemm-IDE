import type { ActivitySpec } from "../contracts/activitySpec";
import type { SpecDraft } from "../compiler/specDraft";
import type { ConfidenceMap, ReadinessResult } from "./readiness";
import { listAgentSelectableLanguages } from "../languages/profiles";
import type { DialogueUpdate } from "./dialogue";
import { selectNextGoal } from "./conversationGoals";
import type { CommitmentStore } from "./commitments";

function formatKnown(spec: SpecDraft): string {
  const parts: string[] = [];
  if (spec.language) parts.push(`language=${spec.language}`);
  if (typeof spec.problem_count === "number") parts.push(`problems=${spec.problem_count}`);
  if (Array.isArray(spec.topic_tags) && spec.topic_tags.length) parts.push(`topics=${spec.topic_tags.join(", ")}`);
  if (typeof spec.problem_style === "string") parts.push(`style=${spec.problem_style}`);
  return parts.join(" • ");
}

function listToSentence(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function confidenceHint(confidence: ConfidenceMap | null | undefined, key: keyof ActivitySpec): string | null {
  const raw = confidence?.[String(key)];
  if (typeof raw !== "number") return null;
  const pct = Math.round(raw * 100);
  return `${pct}%`;
}

function valueToShortString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return "";
}

function buildRevisionLine(update: DialogueUpdate | null | undefined): string | null {
  if (!update) return null;

  const parts: string[] = [];

  const count = update.changed.problem_count;
  if (count && typeof count.from === "number" && typeof count.to === "number") {
    parts.push(`do ${count.to} problems instead of ${count.from}`);
  }

  const lang = update.changed.language;
  if (lang && typeof lang.from === "string" && typeof lang.to === "string") {
    parts.push(`use ${lang.to.toUpperCase()} instead of ${lang.from.toUpperCase()}`);
  }

  const topics = update.changed.topic_tags;
  if (topics && Array.isArray(topics.to)) {
    parts.push(`focus on ${valueToShortString(topics.to)}`);
  }

  const style = update.changed.problem_style;
  if (style && typeof style.to === "string") {
    parts.push(`use ${style.to} style`);
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return `Got it — we’ll ${parts[0]}.`;
  if (parts.length === 2) return `Got it — we’ll ${parts[0]} and ${parts[1]}.`;
  return `Got it — we’ll ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;
}

export function generateNextPrompt(args: {
  spec: SpecDraft;
  readiness: ReadinessResult;
  confidence?: ConfidenceMap | null;
  commitments?: CommitmentStore | null;
  lastUserMessage: string;
  dialogueUpdate?: DialogueUpdate | null;
}): string {
  const known = formatKnown(args.spec);
  const revisionLine = buildRevisionLine(args.dialogueUpdate);
  const preface =
    revisionLine || known ? `${[revisionLine, known ? `So far: ${known}.` : null].filter(Boolean).join("\n")}\n\n` : "";

  if (args.readiness.ready) {
    return preface + "Spec looks complete. You can generate the activity.";
  }

  // If schema complete but confidence is low, prefer confirmation-style prompts.
  if (args.readiness.gaps.complete && args.readiness.lowConfidenceFields.length > 0) {
    const fields = args.readiness.lowConfidenceFields.map(String);
    return (
      preface +
      `Before I generate, I want to confirm ${listToSentence(fields)}.\n` +
      `Can you confirm or adjust those?`
    );
  }

  // If we get here, we have some invalid fields.
  const invalidKeys = Object.keys(args.readiness.gaps.invalid);
  if (invalidKeys.length > 0) {
    const first = invalidKeys[0]!;
    const msg = (args.readiness.gaps.invalid as any)[first] as string | undefined;
    const conf = confidenceHint(args.confidence ?? null, first as any);
    return (
      preface +
      `I need to adjust "${first}"${conf ? ` (confidence ${conf})` : ""}: ${msg ?? "invalid value"}\n` +
      `Can you restate what you want for that?`
    );
  }

  const nextGoal = selectNextGoal({ spec: args.spec, gaps: args.readiness.gaps, commitments: args.commitments ?? null });
  if (nextGoal === "language") {
    const langs = listAgentSelectableLanguages().map((l) => l.toUpperCase()).join(", ");
    return preface + `Which language should we use? (${langs || "JAVA"} is available today.)`;
  }
  if (nextGoal === "scope") {
    return preface + "How many problems should we build? (1–7 works well.)";
  }
  if (nextGoal === "difficulty") {
    const count = typeof args.spec.problem_count === "number" ? args.spec.problem_count : null;
    if (count) {
      const countChanged = args.dialogueUpdate?.changed.problem_count != null;
      return (
        preface +
        `${countChanged ? `Since the count changed, ` : ""}how should we split the difficulty for ${count} problems?\n` +
        `Codemm requires at least 2 difficulty levels with count > 0, and the counts must sum to ${count}.\n` +
        `Example: easy:${Math.max(1, count - 1)}, medium:1`
      );
    }
    return preface + "How hard should the problems be overall? (easy / medium / hard counts)";
  }
  if (nextGoal === "content") {
    return preface + "What should the problems focus on?\nExample: arrays, recursion, hash maps";
  }
  if (nextGoal === "checking") {
    return (
      preface +
      "How should solutions be checked?\n" +
      "- stdout (print output)\n" +
      "- return (method returns a value)\n" +
      "- mixed"
    );
  }

  return preface + "What would you like this activity to focus on?";
}
