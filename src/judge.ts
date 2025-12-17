import { exec } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { JudgeResult } from "./types";
import { trace } from "./utils/trace";

function execAsync(
  command: string,
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd,
        timeout: 2000,
        maxBuffer: 256 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof (error as any).code === "number" ? (error as any).code : error ? 1 : 0;
        resolve({ stdout, stderr, exitCode });
      }
    );
  });
}

function inferClassName(source: string, fallback: string): string {
  const match = source.match(/class\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return match && match[1] ? match[1] : fallback;
}

export async function runJudge(userCode: string, testSuite: string): Promise<JudgeResult> {
  const start = Date.now();
  const tmp = mkdtempSync(join(tmpdir(), "codem-judge-"));

  try {
    const userClassName = inferClassName(userCode, "Solution");
    const testClassName = inferClassName(testSuite, `${userClassName}Test`);

    // Write code using inferred class names so filenames match Java expectations.
    writeFileSync(join(tmp, `${userClassName}.java`), userCode, "utf8");
    writeFileSync(join(tmp, `${testClassName}.java`), testSuite, "utf8");

    // This assumes a Docker image named codem-java-judge is available.
    const dockerCmd = [
      "docker run --rm",
      `-v ${tmp}:/workspace`,
      "codem-java-judge",
    ].join(" ");

    const { stdout, stderr, exitCode } = await execAsync(dockerCmd, tmp);
    trace("judge.result", { exitCode, stdoutLen: stdout.length, stderrLen: stderr.length });

    const executionTimeMs = Date.now() - start;

    // TODO: parse stdout/stderr to determine passed/failed test names.
    return {
      success: exitCode === 0,
      passedTests: [],
      failedTests: [],
      stdout,
      stderr,
      executionTimeMs,
      exitCode,
    };
  } catch (e: any) {
    const executionTimeMs = Date.now() - start;
    return {
      success: false,
      passedTests: [],
      failedTests: [],
      stdout: e?.stdout ?? "",
      stderr: e?.stderr ?? String(e?.error ?? e),
      executionTimeMs,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
