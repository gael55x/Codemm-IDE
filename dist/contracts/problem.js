"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneratedProblemSchema = exports.GeneratedProblemDraftSchema = exports.WorkspaceSchema = exports.WorkspaceFileSchema = void 0;
const zod_1 = require("zod");
const javaRules_1 = require("./javaRules");
const pythonRules_1 = require("./pythonRules");
const cppRules_1 = require("./cppRules");
function stripJavaComments(source) {
    const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
    return withoutBlockComments.replace(/\/\/.*$/gm, "");
}
function hasJavaMainMethod(source) {
    const s = stripJavaComments(source);
    return /public\s+static\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:(?:\[\s*\]|\.\.\.)\s*\w+|\w+\s*\[\s*\])\s*\)/.test(s);
}
function testSuiteReferencesClass(testSuite, className) {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Conservative: only flag real type references, not incidental prose.
    const patterns = [
        new RegExp(`\\bnew\\s+${escaped}\\b`),
        new RegExp(`\\b${escaped}\\s*\\.`),
        new RegExp(`\\b${escaped}\\s*\\(`),
        new RegExp(`\\bextends\\s+${escaped}\\b`),
        new RegExp(`\\bimplements\\s+${escaped}\\b`),
    ];
    return patterns.some((re) => re.test(testSuite));
}
/**
 * Codemm v1.0 Generation output contract for problems.
 *
 * NOTE: reference_solution is required at generation time, validated in Docker,
 * then discarded and MUST NOT be persisted.
 */
const CommonProblemFieldsSchema = zod_1.z
    .object({
    language: zod_1.z.enum(["java", "python", "cpp"]),
    id: zod_1.z.string().trim().min(1).max(80),
    title: zod_1.z.string().trim().min(1).max(120),
    description: zod_1.z.string().trim().min(1).max(8000),
    constraints: zod_1.z.string().trim().min(1).max(2000),
    sample_inputs: zod_1.z.array(zod_1.z.string()).max(20),
    sample_outputs: zod_1.z.array(zod_1.z.string()).max(20),
    // Planned metadata (derived from ProblemPlan, not user chat).
    difficulty: zod_1.z.enum(["easy", "medium", "hard"]),
    topic_tag: zod_1.z.string().trim().min(1).max(40),
})
    .strict();
const JavaTestSuiteSchema = zod_1.z
    .string()
    .min(1)
    .superRefine((ts, ctx) => {
    if (!(0, javaRules_1.isValidJUnit5TestSuite)(ts, 8)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "Invalid test_suite: must have exactly 8 @Test methods, JUnit 5 imports, no package, and non-trivial assertions.",
        });
    }
});
const PythonTestSuiteSchema = zod_1.z
    .string()
    .min(1)
    .superRefine((ts, ctx) => {
    if (!(0, pythonRules_1.isValidPytestTestSuite)(ts, 8)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "Invalid test_suite: must use pytest, import solve from solution, define exactly 8 tests named test_case_1..test_case_8, avoid IO/randomness, and assert solve(...) == expected.",
        });
    }
});
const CppTestSuiteSchema = zod_1.z
    .string()
    .min(1)
    .superRefine((ts, ctx) => {
    if (!(0, cppRules_1.isValidCppTestSuite)(ts, 8)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'Invalid test_suite: must #include "solution.cpp", define a main(), and include exactly 8 RUN_TEST("test_case_1".."test_case_8", ...) tests with deterministic assertions.',
        });
    }
});
const JavaFilenameSchema = zod_1.z
    .string()
    .trim()
    // Phase A: keep it compatible with current /run and /submit (root-level files only).
    .regex(/^[A-Za-z_][A-Za-z0-9_]*\.java$/, "Invalid Java file path.");
exports.WorkspaceFileSchema = zod_1.z
    .object({
    path: JavaFilenameSchema,
    role: zod_1.z.enum(["entry", "support", "readonly"]),
    // For now, workspace problems are Java-only, so we enforce Java source constraints.
    content: javaRules_1.JavaSourceNoPackageSchema,
})
    .strict();
exports.WorkspaceSchema = zod_1.z
    .object({
    files: zod_1.z.array(exports.WorkspaceFileSchema).min(1).max(20),
    // For Java: the class name to run via `java <entrypoint>`. Optional for test-only workspaces.
    entrypoint: zod_1.z.string().trim().min(1).max(120).optional(),
})
    .strict()
    .superRefine((ws, ctx) => {
    const paths = new Set();
    for (const f of ws.files) {
        if (paths.has(f.path)) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `Duplicate workspace file path "${f.path}".`,
                path: ["files"],
            });
        }
        paths.add(f.path);
    }
    const entryFiles = ws.files.filter((f) => f.role === "entry");
    if (entryFiles.length !== 1) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: `workspace.files must include exactly 1 entry file (found ${entryFiles.length}).`,
            path: ["files"],
        });
        return;
    }
    const entryFile = entryFiles[0];
    if (!hasJavaMainMethod(entryFile.content)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: `Entry file "${entryFile.path}" must include public static void main(String[] args).`,
            path: ["files"],
        });
    }
    const entryClassFromFilename = entryFile.path.replace(/\.java$/i, "");
    const entrypoint = ws.entrypoint?.trim();
    if (!entrypoint) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: `workspace.entrypoint is required when using workspace problems (expected "${entryClassFromFilename}").`,
            path: ["entrypoint"],
        });
        return;
    }
    // Ensure the entrypoint maps cleanly to a class defined in the entry file.
    const escaped = entrypoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const content = stripJavaComments(entryFile.content);
    if (!new RegExp(`\\bclass\\s+${escaped}\\b`).test(content)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: `Entry file "${entryFile.path}" must declare class "${entrypoint}".`,
            path: ["files"],
        });
    }
});
const LegacyDraftSchema = CommonProblemFieldsSchema.extend({
    language: zod_1.z.literal("java"),
    test_suite: JavaTestSuiteSchema,
    // Starter code the learner edits.
    starter_code: javaRules_1.JavaSourceNoPackageSchema,
    // Hidden solution used ONLY for validation.
    reference_solution: javaRules_1.JavaSourceNoPackageSchema,
}).strict();
function refineWorkspaceProblem(draft, ctx) {
    const entrypoint = draft.workspace.entrypoint?.trim();
    if (!entrypoint)
        return;
    if (testSuiteReferencesClass(draft.test_suite, entrypoint)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: `test_suite must not reference the entry class "${entrypoint}". Tests must target a non-entry class.`,
            path: ["test_suite"],
        });
    }
}
const WorkspaceDraftSchemaBase = CommonProblemFieldsSchema.extend({
    language: zod_1.z.literal("java"),
    test_suite: JavaTestSuiteSchema,
    workspace: exports.WorkspaceSchema,
    // Hidden solution workspace used ONLY for validation.
    reference_workspace: exports.WorkspaceSchema,
}).strict();
const WorkspaceDraftSchema = WorkspaceDraftSchemaBase.superRefine(refineWorkspaceProblem);
const PythonDraftSchema = CommonProblemFieldsSchema.extend({
    language: zod_1.z.literal("python"),
    test_suite: PythonTestSuiteSchema,
    starter_code: pythonRules_1.PythonSourceSchema,
    reference_solution: pythonRules_1.PythonSourceSchema,
}).strict();
const CppDraftSchema = CommonProblemFieldsSchema.extend({
    language: zod_1.z.literal("cpp"),
    test_suite: CppTestSuiteSchema,
    starter_code: cppRules_1.CppSourceSchema,
    reference_solution: cppRules_1.CppSourceSchema,
}).strict();
exports.GeneratedProblemDraftSchema = zod_1.z.union([
    LegacyDraftSchema,
    WorkspaceDraftSchema,
    PythonDraftSchema,
    CppDraftSchema,
]);
/**
 * Persisted problem shape (reference_solution intentionally omitted).
 */
exports.GeneratedProblemSchema = zod_1.z.union([
    LegacyDraftSchema.omit({ reference_solution: true }),
    WorkspaceDraftSchemaBase.omit({ reference_workspace: true }).superRefine(refineWorkspaceProblem),
    PythonDraftSchema.omit({ reference_solution: true }),
    CppDraftSchema.omit({ reference_solution: true }),
]);
//# sourceMappingURL=problem.js.map