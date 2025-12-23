"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CppSourceSchema = void 0;
exports.isValidCppTestSuite = isValidCppTestSuite;
const zod_1 = require("zod");
function stripCppComments(source) {
    const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
    return withoutBlock.replace(/\/\/.*$/gm, "");
}
exports.CppSourceSchema = zod_1.z
    .string()
    .min(1)
    .superRefine((source, ctx) => {
    const s = stripCppComments(source);
    if (/\bint\s+main\s*\(/.test(s)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'C++ source must not define "main()"; grading uses a separate test runner.',
        });
    }
    if (!/\bsolve\s*\(/.test(s)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'C++ source must define a solve(...) function.',
        });
    }
});
function isValidCppTestSuite(testSuite, testCount) {
    const s = stripCppComments(testSuite);
    if (!/#include\s+"solution\.cpp"/.test(s))
        return false;
    if (!/\bint\s+main\s*\(/.test(s))
        return false;
    // Require exactly testCount tests with stable names:
    // RUN_TEST("test_case_1", {...});
    const re = /RUN_TEST\s*\(\s*"test_case_(\d+)"\s*,/g;
    const found = new Set();
    let m;
    while ((m = re.exec(s)) !== null) {
        const n = Number(m[1]);
        if (Number.isFinite(n))
            found.add(n);
    }
    if (found.size !== testCount)
        return false;
    for (let i = 1; i <= testCount; i++) {
        if (!found.has(i))
            return false;
    }
    // Ensure the runner prints parseable status lines.
    if (!/\[(PASS|FAIL)\]/.test(s))
        return false;
    return true;
}
//# sourceMappingURL=cppRules.js.map