import type { ActivitySpec } from "../contracts/activitySpec";
import type { SpecDraft } from "../specBuilder/validators";
import type { ConfidenceMap, ReadinessResult } from "./readiness";

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

export function generateNextPrompt(args: {
  spec: SpecDraft;
  readiness: ReadinessResult;
  confidence?: ConfidenceMap | null;
  lastUserMessage: string;
}): string {
  const known = formatKnown(args.spec);
  const preface = known ? `So far: ${known}.\n\n` : "";

  // If schema complete but confidence is low, prefer confirmation-style prompts.
  if (args.readiness.gaps.complete && args.readiness.lowConfidenceFields.length > 0) {
    const fields = args.readiness.lowConfidenceFields.map(String);
    return (
      preface +
      `Before I generate, I want to confirm ${listToSentence(fields)}.\n` +
      `Can you confirm or adjust those?`
    );
  }

  // Schema gaps drive the next question.
  const missing = args.readiness.gaps.missing;
  if (missing.includes("language")) {
    return preface + "Which language should we use? (Java is available today.)";
  }
  if (missing.includes("problem_count")) {
    return preface + "How many problems should we build? (1–7 works well.)";
  }
  if (missing.includes("difficulty_plan")) {
    const count = typeof args.spec.problem_count === "number" ? args.spec.problem_count : null;
    if (count) {
      return (
        preface +
        `What difficulty mix do you want for ${count} problems?\n` +
        `Example: easy:2, medium:2, hard:1`
      );
    }
    return preface + "Should this be beginner-friendly, mixed, or interview-level?";
  }
  if (missing.includes("topic_tags")) {
    return (
      preface +
      "What should the problems focus on?\n" +
      "Example: encapsulation, inheritance, polymorphism"
    );
  }
  if (missing.includes("problem_style")) {
    return (
      preface +
      "How should solutions be checked?\n" +
      "- stdout (print output)\n" +
      "- return (method returns a value)\n" +
      "- mixed"
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

  return preface + "What would you like this activity to focus on?";
}

