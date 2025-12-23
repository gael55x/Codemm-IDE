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
  });

export function isValidCppTestSuite(testSuite: string, testCount: number): boolean {
  const s = stripCppComments(testSuite);

  if (!/#include\s+"solution\.cpp"/.test(s)) return false;
  if (!/\bint\s+main\s*\(/.test(s)) return false;

  // Require exactly testCount tests with stable names:
  // RUN_TEST("test_case_1", {...});
  const re = /RUN_TEST\s*\(\s*"test_case_(\d+)"\s*,/g;
  const found = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) found.add(n);
  }

  if (found.size !== testCount) return false;
  for (let i = 1; i <= testCount; i++) {
    if (!found.has(i)) return false;
  }

  // Ensure the runner prints parseable status lines.
  if (!/\[(PASS|FAIL)\]/.test(s)) return false;

  return true;
}
