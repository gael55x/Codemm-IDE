"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUESTIONS = exports.QUESTION_ORDER = void 0;
exports.QUESTION_ORDER = [
    "language",
    "problem_count",
    "difficulty_plan",
    "topic_tags",
    "problem_style",
    "constraints",
];
exports.QUESTIONS = {
    language: "What language should this activity use? (java)",
    problem_count: "How many problems should the activity include? (1-7)",
    difficulty_plan: "How should difficulty be distributed? Provide counts for easy/medium/hard that sum to problem_count (e.g. 'easy:2, medium:2, hard:1').",
    topic_tags: "What topics should the problems cover? Provide 1-12 tags (comma-separated), e.g. 'encapsulation, inheritance, polymorphism'.",
    problem_style: "What problem style do you want? (stdout | return | mixed)",
    constraints: "Provide constraints for solutions (tests are auto-generated). Must mention Java 17, JUnit 5, and 'no package declarations'.",
};
//# sourceMappingURL=questions.js.map