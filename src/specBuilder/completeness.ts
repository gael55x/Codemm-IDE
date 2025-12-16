import { SpecQuestionKey } from "./questions";
import { parseDifficultyCounts, type SpecDraft } from "./validators";

export type CompletenessResult = { complete: boolean; missing: string[] };

function combinedText(buffer: string[]): { raw: string; lower: string } {
  const raw = buffer.join(" ").trim();
  return { raw, lower: raw.toLowerCase() };
}

function numbersInRange(text: string, min: number, max: number): number[] {
  const matches = text.match(/\b\d+\b/g) ?? [];
  const valid = matches
    .map((m) => Number(m))
    .filter((n) => Number.isInteger(n) && n >= min && n <= max);

  return Array.from(new Set(valid));
}

function extractTopicTokens(text: string): string[] {
  const primary = text
    .split(/[,\\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (primary.length > 0) return primary;

  const words = text.match(/[a-z][a-z0-9_-]{1,}/gi) ?? [];
  return words.map((w) => w.trim()).filter(Boolean);
}

export function checkAnswerCompleteness(
  key: SpecQuestionKey,
  buffer: string[],
  spec: SpecDraft
): CompletenessResult {
  const { raw, lower } = combinedText(buffer);
  const missing: string[] = [];

  switch (key) {
    case "language": {
      if (!/\bjava\b/i.test(raw)) {
        missing.push("java");
      }
      break;
    }

    case "problem_count": {
      const values = numbersInRange(lower, 1, 7);
      if (values.length !== 1) {
        missing.push("a single number between 1 and 7");
      }
      break;
    }

    case "difficulty_plan": {
      const counts = parseDifficultyCounts(raw);
      if (!counts) {
        missing.push("counts for easy, medium, and hard");
        break;
      }

      if (typeof counts.easy !== "number") missing.push("easy count");
      if (typeof counts.medium !== "number") missing.push("medium count");
      if (typeof counts.hard !== "number") missing.push("hard count");
      break;
    }

    case "topic_tags": {
      const tags = extractTopicTokens(raw);
      if (tags.length < 1) {
        missing.push("1-12 topic tags (comma-separated)");
      }
      break;
    }

    case "problem_style": {
      const hasStyle = ["stdout", "return", "mixed"].some((style) =>
        new RegExp(`\\b${style}\\b`, "i").test(raw)
      );
      if (!hasStyle) {
        missing.push("problem_style (stdout | return | mixed)");
      }
      break;
    }

    case "constraints": {
      const mentionsJava17 = /java[^\d]{0,10}17/.test(lower) || /17[^\d]{0,10}java/.test(lower);
      const mentionsJunit5 = /junit[^\d]{0,10}5/.test(lower);
      const needsJava17 = !mentionsJava17;
      const needsJunit5 = !mentionsJunit5;
      const needsNoPackage = !/no\s+package/.test(lower);

      if (needsJava17) missing.push("Java 17");
      if (needsJunit5) missing.push("JUnit 5");
      if (needsNoPackage) missing.push("no package declarations");
      break;
    }
  }

  return { complete: missing.length === 0, missing };
}
