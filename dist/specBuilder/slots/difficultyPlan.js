"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.difficultyPlanSlot = void 0;
const activitySpec_1 = require("../../contracts/activitySpec");
const DIFFICULTY_KEYS = ["easy", "medium", "hard"];
function parseCounts(input) {
    const lower = input.toLowerCase();
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const match of lower.matchAll(/(easy|medium|hard)\s*[:=\-]?\s*(\d+)/g)) {
        const key = match[1];
        const rawValue = match[2] ?? "";
        const value = Number.parseInt(rawValue, 10);
        if (key && Number.isFinite(value))
            counts[key] += value;
    }
    for (const match of lower.matchAll(/(\d+)\s*(easy|medium|hard)/g)) {
        const rawValue = match[1] ?? "";
        const key = match[2];
        const value = Number.parseInt(rawValue, 10);
        if (key && Number.isFinite(value))
            counts[key] += value;
    }
    if (counts.easy + counts.medium + counts.hard > 0)
        return counts;
    const nums = lower.match(/\d+/g)?.map((n) => Number.parseInt(n, 10)) ?? [];
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
        const [easy, medium, hard] = nums;
        return { easy, medium, hard };
    }
    // simple phrases: "mostly medium, one easy, one hard"
    if (/mostly\s+medium/.test(lower))
        counts.medium += 2;
    if (/mostly\s+easy/.test(lower))
        counts.easy += 2;
    if (/mostly\s+hard/.test(lower))
        counts.hard += 2;
    if (/one\s+easy/.test(lower))
        counts.easy += 1;
    if (/one\s+medium/.test(lower))
        counts.medium += 1;
    if (/one\s+hard/.test(lower))
        counts.hard += 1;
    if (counts.easy + counts.medium + counts.hard > 0)
        return counts;
    return null;
}
exports.difficultyPlanSlot = {
    key: "difficulty_plan",
    prompt: "How hard should the problems be overall? (easy / medium / hard counts)",
    normalize: (input, ctx) => {
        const parsed = parseCounts(input);
        if (!parsed)
            return null;
        const entries = DIFFICULTY_KEYS.map((difficulty) => ({
            difficulty,
            count: parsed[difficulty],
        })).filter((e) => e.count > 0);
        return entries;
    },
    validate: (value, ctx) => {
        const count = ctx.spec.problem_count;
        if (typeof count !== "number") {
            return "Share the number of problems first, then the difficulty split.";
        }
        const normalized = value.map((v) => ({
            difficulty: activitySpec_1.DifficultySchema.parse(v.difficulty),
            count: v.count,
        }));
        const sum = normalized.reduce((s, v) => s + v.count, 0);
        if (sum !== count) {
            return `I understood the difficulties, but they need to add up to ${count} problems. Try something like: easy:2, medium:2, hard:1`;
        }
        const nonZero = normalized.filter((v) => v.count > 0).length;
        if (nonZero < 2) {
            return "Mix at least two difficulty levels (e.g., easy and medium).";
        }
        return null;
    },
    hint: (ctx) => {
        const count = ctx.spec.problem_count;
        if (typeof count === "number" && count > 0) {
            return `Try an easy:medium:hard breakdown that sums to ${count}, like easy:2, medium:2, hard:1.`;
        }
        return "Share counts for easy, medium, and hard (e.g., easy:2, medium:2, hard:1).";
    },
};
//# sourceMappingURL=difficultyPlan.js.map