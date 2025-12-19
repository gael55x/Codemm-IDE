"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNextPrompt = generateNextPrompt;
const profiles_1 = require("../languages/profiles");
function formatKnown(spec) {
    const parts = [];
    if (spec.language)
        parts.push(`language=${spec.language}`);
    if (typeof spec.problem_count === "number")
        parts.push(`problems=${spec.problem_count}`);
    if (Array.isArray(spec.topic_tags) && spec.topic_tags.length)
        parts.push(`topics=${spec.topic_tags.join(", ")}`);
    if (typeof spec.problem_style === "string")
        parts.push(`style=${spec.problem_style}`);
    return parts.join(" • ");
}
function listToSentence(items) {
    if (items.length === 0)
        return "";
    if (items.length === 1)
        return items[0];
    if (items.length === 2)
        return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function confidenceHint(confidence, key) {
    const raw = confidence?.[String(key)];
    if (typeof raw !== "number")
        return null;
    const pct = Math.round(raw * 100);
    return `${pct}%`;
}
function valueToShortString(value) {
    if (value == null)
        return "";
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (Array.isArray(value))
        return value.map(String).join(", ");
    return "";
}
function buildRevisionLine(update) {
    if (!update)
        return null;
    const priority = [
        "problem_count",
        "language",
        "topic_tags",
        "problem_style",
        "difficulty_plan",
    ];
    const key = priority.find((k) => update.changed[k] != null) ?? null;
    if (!key)
        return null;
    const change = update.changed[key];
    if (!change)
        return null;
    if (key === "problem_count" && typeof change.from === "number" && typeof change.to === "number") {
        return `Got it — we’ll do ${change.to} problems instead of ${change.from}.`;
    }
    if (key === "language" && typeof change.from === "string" && typeof change.to === "string") {
        return `Got it — we’ll use ${change.to.toUpperCase()} instead of ${change.from.toUpperCase()}.`;
    }
    if (key === "topic_tags" && Array.isArray(change.to)) {
        return `Got it — we’ll focus on ${valueToShortString(change.to)}.`;
    }
    if (key === "problem_style" && typeof change.to === "string") {
        return `Got it — we’ll use ${change.to} style.`;
    }
    return null;
}
function generateNextPrompt(args) {
    const known = formatKnown(args.spec);
    const revisionLine = buildRevisionLine(args.dialogueUpdate);
    const preface = revisionLine || known ? `${[revisionLine, known ? `So far: ${known}.` : null].filter(Boolean).join("\n")}\n\n` : "";
    if (args.readiness.ready) {
        return preface + "Spec looks complete. You can generate the activity.";
    }
    // If schema complete but confidence is low, prefer confirmation-style prompts.
    if (args.readiness.gaps.complete && args.readiness.lowConfidenceFields.length > 0) {
        const fields = args.readiness.lowConfidenceFields.map(String);
        return (preface +
            `Before I generate, I want to confirm ${listToSentence(fields)}.\n` +
            `Can you confirm or adjust those?`);
    }
    // Schema gaps drive the next question.
    const missing = args.readiness.gaps.missing;
    if (missing.includes("language")) {
        const langs = (0, profiles_1.listAgentSelectableLanguages)().map((l) => l.toUpperCase()).join(", ");
        return preface + `Which language should we use? (${langs || "JAVA"} is available today.)`;
    }
    if (missing.includes("problem_count")) {
        return preface + "How many problems should we build? (1–7 works well.)";
    }
    if (missing.includes("difficulty_plan")) {
        const count = typeof args.spec.problem_count === "number" ? args.spec.problem_count : null;
        if (count) {
            const countChanged = args.dialogueUpdate?.changed.problem_count != null;
            return (preface +
                `${countChanged ? `Since the count changed, ` : ""}how should we split the difficulty for ${count} problems?\n` +
                `Example: easy:2, medium:2, hard:1`);
        }
        return preface + "Should this be beginner-friendly, mixed, or interview-level?";
    }
    if (missing.includes("topic_tags")) {
        return (preface +
            "What should the problems focus on?\n" +
            "Example: encapsulation, inheritance, polymorphism");
    }
    if (missing.includes("problem_style")) {
        return (preface +
            "How should solutions be checked?\n" +
            "- stdout (print output)\n" +
            "- return (method returns a value)\n" +
            "- mixed");
    }
    // If we get here, we have some invalid fields.
    const invalidKeys = Object.keys(args.readiness.gaps.invalid);
    if (invalidKeys.length > 0) {
        const first = invalidKeys[0];
        const msg = args.readiness.gaps.invalid[first];
        const conf = confidenceHint(args.confidence ?? null, first);
        return (preface +
            `I need to adjust "${first}"${conf ? ` (confidence ${conf})` : ""}: ${msg ?? "invalid value"}\n` +
            `Can you restate what you want for that?`);
    }
    return preface + "What would you like this activity to focus on?";
}
//# sourceMappingURL=promptGenerator.js.map