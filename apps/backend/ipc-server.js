/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// IPC engine entrypoint.
// - In dev: loads TS via ts-node
// - In production builds: loads dist output
//
// This keeps Electron main simple (fork this file and speak process IPC).

const distEntry = path.join(__dirname, "dist", "ipcServer.js");
if (fs.existsSync(distEntry)) {
  require(distEntry);
} else {
  // Dev-only dependency
  require("ts-node/register");
  require("./src/ipcServer.ts");
}

