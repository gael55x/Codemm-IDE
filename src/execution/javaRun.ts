import { exec } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { inferClassName } from "../utils/javaCodegen";

function getRunTimeoutMs(): number {
  const raw = process.env.CODEMM_RUN_TIMEOUT_MS;
  if (!raw) return 8000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 8000;
  // Hard cap to avoid runaway local resource use.
  return Math.min(Math.floor(n), 30_000);
}

function execAsync(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd,
        timeout: getRunTimeoutMs(),
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject({ error, stdout, stderr });
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export type RunResult = {
  stdout: string;
  stderr: string;
};

export type JavaFiles = Record<string, string>;

function assertSafeJavaMainClassName(mainClass: string): string {
  const trimmed = mainClass.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid mainClass "${mainClass}".`);
  }
  return trimmed;
}

function hasJavaMainMethod(source: string): boolean {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, "");
  return /public\s+static\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:(?:\[\s*\]|\.\.\.)\s*\w+|\w+\s*\[\s*\])\s*\)/.test(
    withoutLineComments
  );
}

function inferMainClassFromFiles(files: JavaFiles): string | null {
  for (const [filename, source] of Object.entries(files)) {
    if (!hasJavaMainMethod(source)) continue;
    const fallback = filename.replace(/\.java$/i, "") || "Main";
    return inferClassName(source, fallback);
  }
  return null;
}

export async function runJavaFiles(opts: {
  files: JavaFiles;
  mainClass?: string;
  stdin?: string;
}): Promise<RunResult> {
  const tmp = mkdtempSync(join(tmpdir(), "codem-run-"));

  try {
    for (const [filename, source] of Object.entries(opts.files)) {
      writeFileSync(join(tmp, filename), source, "utf8");
    }

    const inferred = opts.mainClass ?? inferMainClassFromFiles(opts.files);
    const mainClass = inferred ? assertSafeJavaMainClassName(inferred) : null;
    if (!mainClass) {
      return {
        stdout: "",
        stderr:
          "No runnable Java entrypoint found. Add `public static void main(String[] args)` to a class, or specify mainClass.",
      };
    }

    const hasStdin = typeof opts.stdin === "string";
    if (hasStdin) {
      writeFileSync(join(tmp, "stdin.txt"), opts.stdin ?? "", "utf8");
    }

    const runCmd = hasStdin ? `java ${mainClass} < stdin.txt` : `java ${mainClass}`;

    // Reuse the existing judge image, but override ENTRYPOINT so it doesn't run JUnit.
    const dockerCmd = [
      "docker run --rm",
      `-v ${tmp}:/workspace`,
      "--entrypoint /bin/bash",
      "codem-java-judge",
      `-lc "javac *.java && ${runCmd}"`,
    ].join(" ");

    const { stdout, stderr } = await execAsync(dockerCmd, tmp);
    return { stdout, stderr };
  } catch (e: any) {
    const msg =
      typeof e?.error?.message === "string"
        ? e.error.message
        : typeof e?.message === "string"
        ? e.message
        : "";
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? (msg || String(e.error ?? e)),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Terminal-style execution: compile + run user code only.
 *
 * - No test suite
 * - No persistence
 * - Uses the existing codem-java-judge image but overrides entrypoint
 */
export async function runJavaCodeOnly(userCode: string, stdin?: string): Promise<RunResult> {
  const userClassName = inferClassName(userCode, "Solution");
  const opts: { files: JavaFiles; mainClass: string; stdin?: string } = {
    files: { [`${userClassName}.java`]: userCode },
    mainClass: userClassName,
  };
  if (typeof stdin === "string") {
    opts.stdin = stdin;
  }
  return runJavaFiles(opts);
}
