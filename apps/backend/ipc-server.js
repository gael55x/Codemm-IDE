/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// IPC engine entrypoint.
// - In dev: loads TS via ts-node
// - In production builds: loads dist output
//
// This keeps Electron main simple (fork this file and speak process IPC).

const distEntry = path.join(__dirname, "dist", "ipcServer.js");
const useDist = process.env.NODE_ENV === "production" || process.env.CODEMM_ENGINE_USE_DIST === "1";
if (useDist && fs.existsSync(distEntry)) {
  require(distEntry);
} else {
  // Dev-only dependency (force backend-local tsconfig so module format is CJS).
  require("ts-node").register({
    transpileOnly: true,
    project: path.join(__dirname, "tsconfig.json"),
    compilerOptions: { module: "commonjs" },
  });
  require("./src/ipcServer.ts");
}
