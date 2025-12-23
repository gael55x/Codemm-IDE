import { z } from "zod";
import { JavaSourceNoPackageSchema, isValidJUnit5TestSuite } from "./javaRules";
import { PythonSourceSchema, isValidPytestTestSuite } from "./pythonRules";
import { CppSourceSchema, isValidCppTestSuite } from "./cppRules";

function stripJavaComments(source: string): string {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments.replace(/\/\/.*$/gm, "");
}

function hasJavaMainMethod(source: string): boolean {
  const s = stripJavaComments(source);
  return /public\s+static\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:(?:\[\s*\]|\.\.\.)\s*\w+|\w+\s*\[\s*\])\s*\)/.test(
    s
  );
}

function testSuiteReferencesClass(testSuite: string, className: string): boolean {
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
const CommonProblemFieldsSchema = z
  .object({
    language: z.enum(["java", "python", "cpp"]),
    id: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(8000),

    constraints: z.string().trim().min(1).max(2000),

    sample_inputs: z.array(z.string()).max(20),
    sample_outputs: z.array(z.string()).max(20),

    // Planned metadata (derived from ProblemPlan, not user chat).
    difficulty: z.enum(["easy", "medium", "hard"]),
    topic_tag: z.string().trim().min(1).max(40),
  })
  .strict();

const JavaTestSuiteSchema = z
  .string()
  .min(1)
  .superRefine((ts, ctx) => {
    if (!isValidJUnit5TestSuite(ts, 8)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Invalid test_suite: must have exactly 8 @Test methods, JUnit 5 imports, no package, and non-trivial assertions.",
      });
    }
  });

const PythonTestSuiteSchema = z
  .string()
  .min(1)
  .superRefine((ts, ctx) => {
    if (!isValidPytestTestSuite(ts, 8)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Invalid test_suite: must use pytest, import solve from solution, define exactly 8 tests named test_case_1..test_case_8, avoid IO/randomness, and assert solve(...) == expected.",
      });
    }
  });

const CppTestSuiteSchema = z
  .string()
  .min(1)
  .superRefine((ts, ctx) => {
    if (!isValidCppTestSuite(ts, 8)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Invalid test_suite: must #include "solution.cpp", define a main(), and include exactly 8 RUN_TEST("test_case_1".."test_case_8", ...) tests with deterministic assertions.',
      });
    }
  });

const JavaFilenameSchema = z
  .string()
  .trim()
  // Phase A: keep it compatible with current /run and /submit (root-level files only).
  .regex(/^[A-Za-z_][A-Za-z0-9_]*\.java$/, "Invalid Java file path.");

export const WorkspaceFileSchema = z
  .object({
    path: JavaFilenameSchema,
    role: z.enum(["entry", "support", "readonly"]),
    // For now, workspace problems are Java-only, so we enforce Java source constraints.
    content: JavaSourceNoPackageSchema,
  })
  .strict();

export const WorkspaceSchema = z
  .object({
    files: z.array(WorkspaceFileSchema).min(1).max(20),
    // For Java: the class name to run via `java <entrypoint>`. Optional for test-only workspaces.
    entrypoint: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((ws, ctx) => {
    const paths = new Set<string>();
    for (const f of ws.files) {
      if (paths.has(f.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate workspace file path "${f.path}".`,
          path: ["files"],
        });
      }
      paths.add(f.path);
    }

    const entryFiles = ws.files.filter((f) => f.role === "entry");
    if (entryFiles.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `workspace.files must include exactly 1 entry file (found ${entryFiles.length}).`,
        path: ["files"],
      });
      return;
    }

    const entryFile = entryFiles[0]!;
    if (!hasJavaMainMethod(entryFile.content)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Entry file "${entryFile.path}" must include public static void main(String[] args).`,
        path: ["files"],
      });
    }

    const entryClassFromFilename = entryFile.path.replace(/\.java$/i, "");
    const entrypoint = ws.entrypoint?.trim();
    if (!entrypoint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
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
        code: z.ZodIssueCode.custom,
        message: `Entry file "${entryFile.path}" must declare class "${entrypoint}".`,
        path: ["files"],
      });
    }
  });

const LegacyDraftSchema = CommonProblemFieldsSchema.extend({
  language: z.literal("java"),
  test_suite: JavaTestSuiteSchema,
  // Starter code the learner edits.
  starter_code: JavaSourceNoPackageSchema,
  // Hidden solution used ONLY for validation.
  reference_solution: JavaSourceNoPackageSchema,
}).strict();

function refineWorkspaceProblem(
  draft: { test_suite: string; workspace: { entrypoint?: string | undefined } },
  ctx: z.RefinementCtx
) {
  const entrypoint = draft.workspace.entrypoint?.trim();
  if (!entrypoint) return;
  if (testSuiteReferencesClass(draft.test_suite, entrypoint)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `test_suite must not reference the entry class "${entrypoint}". Tests must target a non-entry class.`,
      path: ["test_suite"],
    });
  }
}

const WorkspaceDraftSchemaBase = CommonProblemFieldsSchema.extend({
  language: z.literal("java"),
  test_suite: JavaTestSuiteSchema,
  workspace: WorkspaceSchema,
  // Hidden solution workspace used ONLY for validation.
  reference_workspace: WorkspaceSchema,
}).strict();

const WorkspaceDraftSchema = WorkspaceDraftSchemaBase.superRefine(refineWorkspaceProblem);

const PythonDraftSchema = CommonProblemFieldsSchema.extend({
  language: z.literal("python"),
  test_suite: PythonTestSuiteSchema,
  starter_code: PythonSourceSchema,
  reference_solution: PythonSourceSchema,
}).strict();

const CppDraftSchema = CommonProblemFieldsSchema.extend({
  language: z.literal("cpp"),
  test_suite: CppTestSuiteSchema,
  starter_code: CppSourceSchema,
  reference_solution: CppSourceSchema,
}).strict();

export const GeneratedProblemDraftSchema = z.union([
  LegacyDraftSchema,
  WorkspaceDraftSchema,
  PythonDraftSchema,
  CppDraftSchema,
]);

export type GeneratedProblemDraft = z.infer<typeof GeneratedProblemDraftSchema>;

/**
 * Persisted problem shape (reference_solution intentionally omitted).
 */
export const GeneratedProblemSchema = z.union([
  LegacyDraftSchema.omit({ reference_solution: true }),
  WorkspaceDraftSchemaBase.omit({ reference_workspace: true }).superRefine(refineWorkspaceProblem),
  PythonDraftSchema.omit({ reference_solution: true }),
  CppDraftSchema.omit({ reference_solution: true }),
]);

export type GeneratedProblem = z.infer<typeof GeneratedProblemSchema>;
