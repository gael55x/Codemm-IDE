import { exec } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { JudgeResult } from "./config";

function execAsync(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd,
        timeout: 2000,
        maxBuffer: 256 * 1024,
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

    const { stdout, stderr } = await execAsync(dockerCmd, tmp);

    const executionTimeMs = Date.now() - start;

    // TODO: parse stdout/stderr to determine passed/failed test names.
    return {
      success: !stderr,
      passedTests: [],
      failedTests: [],
      stdout,
      stderr,
      executionTimeMs,
    };
  } catch (e: any) {
    const executionTimeMs = Date.now() - start;
    return {
      success: false,
      passedTests: [],
      failedTests: [],
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(e.error ?? e),
      executionTimeMs,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}


