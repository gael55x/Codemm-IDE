"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runJudge = runJudge;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const trace_1 = require("./utils/trace");
function execAsync(command, cwd) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)(command, {
            cwd,
            timeout: 2000,
            maxBuffer: 256 * 1024,
        }, (error, stdout, stderr) => {
            const exitCode = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
            resolve({ stdout, stderr, exitCode });
        });
    });
}
function inferClassName(source, fallback) {
    const match = source.match(/class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    return match && match[1] ? match[1] : fallback;
}
async function runJudge(userCode, testSuite) {
    const start = Date.now();
    const tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "codem-judge-"));
    try {
        const userClassName = inferClassName(userCode, "Solution");
        const testClassName = inferClassName(testSuite, `${userClassName}Test`);
        // Write code using inferred class names so filenames match Java expectations.
        (0, fs_1.writeFileSync)((0, path_1.join)(tmp, `${userClassName}.java`), userCode, "utf8");
        (0, fs_1.writeFileSync)((0, path_1.join)(tmp, `${testClassName}.java`), testSuite, "utf8");
        // This assumes a Docker image named codem-java-judge is available.
        const dockerCmd = [
            "docker run --rm",
            `-v ${tmp}:/workspace`,
            "codem-java-judge",
        ].join(" ");
        const { stdout, stderr, exitCode } = await execAsync(dockerCmd, tmp);
        (0, trace_1.trace)("judge.result", { exitCode, stdoutLen: stdout.length, stderrLen: stderr.length });
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
    }
    catch (e) {
        const executionTimeMs = Date.now() - start;
        return {
            success: false,
            passedTests: [],
            failedTests: [],
            stdout: e?.stdout ?? "",
            stderr: e?.stderr ?? String(e?.error ?? e),
            executionTimeMs,
        };
    }
    finally {
        (0, fs_1.rmSync)(tmp, { recursive: true, force: true });
    }
}
//# sourceMappingURL=judge.js.map