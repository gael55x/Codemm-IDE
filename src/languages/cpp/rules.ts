import { z } from "zod";

function stripCppComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock.replace(/\/\/.*$/gm, "");
}

export const CppSourceSchema = z
  .string()
  .min(1)
  .superRefine((source, ctx) => {
    const s = stripCppComments(source);
    if (/\bint\s+main\s*\(/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'C++ source must not define "main()"; grading uses a separate test runner.',
      });
    }
    if (!/\bsolve\s*\(/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'C++ source must define a solve(...) function.',
      });
    }

    // The C++ contract uses a return-based solve(...) function. Reading from stdin will block in Docker
    // and show up as a "timedOut" judge result. Disallow common stdin patterns to prevent hangs.
    const readsFromStdin =
      /\b(?:std::)?cin\s*>>/.test(s) ||
      /\bscanf\s*\(/.test(s) ||
      /\bgetchar\s*\(/.test(s) ||
      /\bfgets\s*\(/.test(s) ||
      /\bgetline\s*\(\s*(?:std::)?cin\b/.test(s);
    if (readsFromStdin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'C++ solve(...) must not read from stdin (use only the function arguments; stdin reads will hang in the Docker judge).',
      });
    }

    // Output is also not supported for the current C++ contract (tests call solve(...) and compare return values).
    const writesToStdout =
      /\b(?:std::)?cout\s*<</.test(s) ||
      /\b(?:std::)?cerr\s*<</.test(s) ||
      /\bprintf\s*\(/.test(s) ||
      /\bfprintf\s*\(/.test(s) ||
      /\bputs\s*\(/.test(s);
    if (writesToStdout) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'C++ solve(...) must not write to stdout/stderr (return a value; the harness handles all printing).',
      });
    }
  });

export type CppTestSuiteDiagnostics = {
  includesSolutionCpp: boolean;
  hasMain: boolean;
  hasRunTestCalls: boolean;
  hasVariadicRunTestMacro: boolean;
  hasPassFailOutput: boolean;
  foundTestNumbers: number[];
};

export function diagnoseCppTestSuite(testSuite: string): CppTestSuiteDiagnostics {
  const s = stripCppComments(testSuite ?? "");

  const includesSolutionCpp = /#\s*include\s+"solution\.cpp"/.test(s);
  const hasMain = /\bint\s+main\s*\(/.test(s);

  const found = new Set<number>();
  const collect = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) found.add(n);
    }
  };

  // Primary: macro style.
  collect(/\bRUN_TEST\s*\(\s*"test_case_(\d+)"\s*(?:,|\))/g);
  // Fallback: function-based runner style.
  if (found.size === 0) {
    collect(/\brun\s*\(\s*"test_case_(\d+)"\s*(?:,|\))/g);
  }
  // Last resort: function definitions only.
  if (found.size === 0) {
    collect(/\b(?:void|bool|int)\s+test_case_(\d+)\s*\(/g);
  }

  const foundTestNumbers = Array.from(found).sort((a, b) => a - b);

  // If using RUN_TEST, require it to be variadic to avoid comma parsing failures.
  const hasRunTestCalls = /\bRUN_TEST\s*\(/.test(s);
  const hasVariadicRunTestMacro = !hasRunTestCalls
    ? true
    : /^\s*#\s*define\s+RUN_TEST\s*\([^)]*\.\.\.[^)]*\)/m.test(s);

  // Ensure the runner prints parseable status lines.
  const hasPassFailOutput = /\[(PASS|FAIL)\]/.test(s);

  return {
    includesSolutionCpp,
    hasMain,
    hasRunTestCalls,
    hasVariadicRunTestMacro,
    hasPassFailOutput,
    foundTestNumbers,
  };
}

export function isValidCppTestSuite(testSuite: string, testCount: number): boolean {
  const d = diagnoseCppTestSuite(testSuite);
  const hasAllTests =
    d.foundTestNumbers.length === testCount &&
    Array.from({ length: testCount }, (_, i) => i + 1).every((n) => d.foundTestNumbers.includes(n));

  return (
    d.includesSolutionCpp &&
    d.hasMain &&
    hasAllTests &&
    d.hasVariadicRunTestMacro &&
    d.hasPassFailOutput
  );
}
