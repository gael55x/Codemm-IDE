"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_CONFIDENCE = void 0;
exports.computeReadiness = computeReadiness;
const specAnalysis_1 = require("./specAnalysis");
exports.REQUIRED_CONFIDENCE = {
    language: 0.9,
    problem_count: 0.8,
    difficulty_plan: 0.8,
    topic_tags: 0.6,
    problem_style: 0.6,
};
function getConfidence(confidence, key) {
    const raw = confidence?.[String(key)];
    if (typeof raw !== "number" || !Number.isFinite(raw))
        return 0;
    return Math.max(0, Math.min(1, raw));
}
function computeReadiness(spec, confidence) {
    const gaps = (0, specAnalysis_1.analyzeSpecGaps)(spec);
    const lowConfidenceFields = [];
    let minConfidence = 1;
    for (const [k, threshold] of Object.entries(exports.REQUIRED_CONFIDENCE)) {
        const key = k;
        const required = typeof threshold === "number" ? threshold : 0;
        const c = getConfidence(confidence, key);
        minConfidence = Math.min(minConfidence, c);
        if (c < required) {
            lowConfidenceFields.push(key);
        }
    }
    const ready = gaps.complete && lowConfidenceFields.length === 0;
    return { ready, gaps, minConfidence, lowConfidenceFields };
}
//# sourceMappingURL=readiness.js.map