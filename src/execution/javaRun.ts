import { exec } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { inferClassName } from "../utils/javaCodegen";

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

export type RunResult = {
  stdout: string;
  stderr: string;
};

/**
 * Terminal-style execution: compile + run user code only.
 *
 * - No test suite
 * - No persistence
 * - Uses the existing codem-java-judge image but overrides entrypoint
 */
export async function runJavaCodeOnly(userCode: string): Promise<RunResult> {
  const tmp = mkdtempSync(join(tmpdir(), "codem-run-"));

  try {
    const userClassName = inferClassName(userCode, "Solution");
    writeFileSync(join(tmp, `${userClassName}.java`), userCode, "utf8");

    // Reuse the existing judge image, but override ENTRYPOINT so it doesn't run JUnit.
    const dockerCmd = [
      "docker run --rm",
      `-v ${tmp}:/workspace`,
      "--entrypoint /bin/bash",
      "codem-java-judge",
      `-lc "javac *.java && java ${userClassName}"`,
    ].join(" ");

    const { stdout, stderr } = await execAsync(dockerCmd, tmp);
    return { stdout, stderr };
  } catch (e: any) {
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(e.error ?? e),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
