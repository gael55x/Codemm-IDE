/* eslint-disable no-console */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const DEFAULT_BACKEND_PORT = Number.parseInt(process.env.CODEMM_BACKEND_PORT || "4000", 10);
const DEFAULT_FRONTEND_PORT = Number.parseInt(process.env.CODEMM_FRONTEND_PORT || "3000", 10);

// Keep a global reference so the window isn't garbage-collected on macOS.
/** @type {import("electron").BrowserWindow | null} */
let mainWindow = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForHttpOk(url, { timeoutMs = 120_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastLogAt = 0;

  async function once() {
    return new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2_000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  return (async () => {
    while (Date.now() < deadline) {
      // Treat any HTTP response as "up" (even 404) because Next.js may respond with redirects/404s.
      if (await once()) return true;
      if (Date.now() - lastLogAt > 5000) {
        lastLogAt = Date.now();
        console.log(`[ide] Waiting for ${url}...`);
      }
      await sleep(intervalMs);
    }
    return false;
  })();
}

function existsExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findDockerBinary() {
  if (process.env.DOCKER_PATH && existsExecutable(process.env.DOCKER_PATH)) {
    return process.env.DOCKER_PATH;
  }

  const candidates = [
    "docker", // PATH
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ];

  for (const c of candidates) {
    if (c === "docker") return "docker";
    if (existsExecutable(c)) return c;
  }

  return null;
}

function checkDockerRunning({ dockerBin, timeoutMs = 8000 }) {
  const res = spawnSync(dockerBin, ["info"], {
    stdio: "pipe",
    timeout: timeoutMs,
    encoding: "utf8",
  });

  if (res.error && res.error.code === "ETIMEDOUT") {
    return { ok: false, reason: `Timed out after ${timeoutMs}ms while running "docker info".` };
  }

  if (res.status === 0) return { ok: true, reason: "" };

  const detail = String((res.stderr || res.stdout || "")).trim();
  return {
    ok: false,
    reason: detail || `docker info exited with code ${String(res.status)}`,
  };
}

async function waitForDockerRunning({
  dockerBin,
  totalTimeoutMs = 180_000,
  tryTimeoutMs = 8_000,
  intervalMs = 2_000,
} = {}) {
  const deadline = Date.now() + totalTimeoutMs;
  let lastLogAt = 0;
  /** @type {string} */
  let lastReason = "Not checked yet";

  while (Date.now() < deadline) {
    const r = checkDockerRunning({ dockerBin, timeoutMs: tryTimeoutMs });
    if (r.ok) return { ok: true, reason: "" };
    lastReason = r.reason;

    if (Date.now() - lastLogAt > 5000) {
      lastLogAt = Date.now();
      console.log(`[ide] Docker not ready yet; retrying... (${lastReason})`);
    }

    await sleep(intervalMs);
  }

  return { ok: false, reason: lastReason };
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    // On macOS/Linux, negative PID targets the full process group when spawned with `detached: true`.
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

function wireLogs(name, proc) {
  if (!proc) return;
  proc.stdout?.on("data", (buf) => process.stdout.write(`[${name}] ${buf}`));
  proc.stderr?.on("data", (buf) => process.stderr.write(`[${name}] ${buf}`));
}

async function ensureNodeModules({ dir, label, env }) {
  const nm = path.join(dir, "node_modules");
  if (fs.existsSync(nm)) {
    console.log(`[ide] ${label}: node_modules present, skipping npm install`);
    return true;
  }

  console.log(`[ide] ${label}: installing npm dependencies...`);
  const child = spawn("npm", ["install"], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  wireLogs(`${label}:npm`, child);

  const code = await new Promise((resolve) => {
    child.on("exit", (c) => resolve(c));
    child.on("error", () => resolve(1));
  });

  return code === 0;
}

async function spawnAndWait(name, cmd, args, { cwd, env }) {
  const child = spawn(cmd, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  wireLogs(name, child);

  const code = await new Promise((resolve) => {
    child.on("exit", (c) => resolve(typeof c === "number" ? c : 1));
    child.on("error", () => resolve(1));
  });
  return code;
}

async function ensureJudgeImages({ dockerBin, backendDir, env }) {
  const rebuild = process.env.CODEMM_REBUILD_JUDGE === "1";
  const images = [
    { image: "codem-java-judge", dockerfile: "Dockerfile.java-judge" },
    { image: "codem-python-judge", dockerfile: "Dockerfile.python-judge" },
    { image: "codem-cpp-judge", dockerfile: "Dockerfile.cpp-judge" },
    { image: "codem-sql-judge", dockerfile: "Dockerfile.sql-judge" },
  ];

  for (const { image, dockerfile } of images) {
    if (rebuild) {
      console.log(`[ide] Rebuilding judge image: ${image}`);
      spawnSync(dockerBin, ["image", "rm", "-f", `${image}:latest`], { stdio: "ignore" });
    }

    const exists =
      spawnSync(dockerBin, ["image", "inspect", `${image}:latest`], { stdio: "ignore" }).status ===
      0;

    if (exists && !rebuild) {
      console.log(`[ide] Judge image found: ${image}`);
      continue;
    }

    console.log(`[ide] Building judge image: ${image} (from ${dockerfile})...`);
    const code = await spawnAndWait(
      `docker:${image}`,
      dockerBin,
      ["build", "--progress=plain", "-f", dockerfile, "-t", image, "."],
      { cwd: backendDir, env },
    );
    if (code !== 0) return false;
  }

  return true;
}

async function createWindowAndBoot() {
  // __dirname = apps/ide
  const repoRoot = path.resolve(__dirname, "..", "..");
  const backendDir =
    process.env.CODEMM_BACKEND_DIR || path.join(repoRoot, "apps", "backend");
  const frontendDir =
    process.env.CODEMM_FRONTEND_DIR || path.join(repoRoot, "apps", "frontend");

  console.log(`[ide] repoRoot=${repoRoot}`);
  console.log(`[ide] backendDir=${backendDir}`);
  console.log(`[ide] frontendDir=${frontendDir}`);

  const dockerBin = findDockerBinary();
  if (!dockerBin) {
    dialog.showErrorBox(
      "Docker Not Found",
      [
        "Codemm requires Docker for judging (/run and /submit).",
        "Install Docker Desktop and ensure `docker` is available in your PATH,",
        "or set DOCKER_PATH to the docker binary.",
      ].join("\n"),
    );
    app.quit();
    return;
  }
  console.log(`[ide] dockerBin=${dockerBin}`);

  console.log('[ide] Checking Docker ("docker info")...');
  const dockerCheck = await waitForDockerRunning({ dockerBin });
  if (!dockerCheck.ok) {
    dialog.showErrorBox(
      "Docker Not Running",
      [
        "Codemm requires Docker for judging.",
        "Start Docker Desktop, wait until it's running, then relaunch Codemm-IDE.",
        "",
        `Details: ${dockerCheck.reason}`,
      ].join("\n"),
    );
    app.quit();
    return;
  }
  console.log("[ide] Docker is running");

  const backendUrl = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
  const frontendUrl = `http://127.0.0.1:${DEFAULT_FRONTEND_PORT}`;
  console.log(`[ide] backendUrl=${backendUrl}`);
  console.log(`[ide] frontendUrl=${frontendUrl}`);

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    show: true,
    backgroundColor: "#0b1220",
    webPreferences: {
      // Keep this strict. If we later need IPC, add a preload script.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
  });

  // Hard block popups; if the UI needs external links, we can explicitly open them with `shell.openExternal`.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // If this is an external URL, open it in the user's browser.
    if (url && /^https?:\/\//.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });

  win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Codemm-IDE</title>
          <style>
            html, body { height: 100%; margin: 0; }
            body {
              font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
              background: radial-gradient(1200px 800px at 20% 10%, #172554 0%, #0b1220 55%, #050814 100%);
              color: #e2e8f0;
              display: grid;
              place-items: center;
            }
            .card {
              width: min(720px, calc(100vw - 40px));
              border: 1px solid rgba(148, 163, 184, 0.18);
              background: rgba(2, 6, 23, 0.45);
              border-radius: 16px;
              padding: 22px 22px;
              box-shadow: 0 24px 80px rgba(0,0,0,0.45);
            }
            h1 { font-size: 16px; margin: 0 0 12px 0; letter-spacing: 0.02em; }
            .muted { color: rgba(226, 232, 240, 0.78); font-size: 13px; line-height: 1.5; }
            .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
            .row { display: flex; gap: 10px; margin-top: 14px; align-items: center; }
            .dot {
              width: 10px; height: 10px; border-radius: 999px;
              background: #38bdf8;
              box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.55);
              animation: pulse 1.6s infinite;
            }
            @keyframes pulse {
              0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.55); }
              70% { box-shadow: 0 0 0 12px rgba(56, 189, 248, 0.0); }
              100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.0); }
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Starting Codemm-IDE…</h1>
            <div class="muted">
              Booting backend (agent + judge) and frontend UI locally.
              Docker is required for judging.
            </div>
            <div class="row muted">
              <div class="dot"></div>
              <div>Backend: <span class="mono">${backendUrl}</span> · Frontend: <span class="mono">${frontendUrl}</span></div>
            </div>
            <div class="muted" style="margin-top: 14px;">
              If this hangs, check the terminal logs for missing deps or port conflicts.
            </div>
          </div>
        </body>
      </html>
    `)}`,
  );

  let backendProc = null;
  let frontendProc = null;

  const baseEnv = { ...process.env };
  // Improve odds of finding docker from a GUI-launched app (PATH can be minimal on macOS).
  if (dockerBin !== "docker") {
    const dockerDir = path.dirname(dockerBin);
    baseEnv.PATH = baseEnv.PATH ? `${dockerDir}:${baseEnv.PATH}` : dockerDir;
  }

  // Ensure monorepo dependencies exist (npm workspaces).
  {
    const ok = await ensureNodeModules({ dir: repoRoot, label: "repo", env: baseEnv });
    if (!ok) {
      dialog.showErrorBox(
        "Dependencies Failed",
        `Failed to install npm dependencies in ${repoRoot}. Check terminal logs.`,
      );
      app.quit();
      return;
    }
  }

  // Ensure Docker judge images exist (Codemm compiles/runs in Docker).
  {
    console.log("[ide] Ensuring judge Docker images...");
    const ok = await ensureJudgeImages({ dockerBin, backendDir, env: baseEnv });
    if (!ok) {
      dialog.showErrorBox(
        "Judge Images Failed",
        "Failed to build judge Docker images. Check terminal logs and ensure Docker Desktop has enough resources.",
      );
      app.quit();
      return;
    }
  }

  // Start backend (workspace).
  console.log("[ide] Starting backend (workspace codem-backend)...");
  backendProc = spawn("npm", ["--workspace", "codem-backend", "run", "dev"], {
    cwd: repoRoot,
    env: {
      ...baseEnv,
      PORT: String(DEFAULT_BACKEND_PORT),
      // Avoid a noisy welcome prompt in packaging contexts.
      CODEMM_HTTP_LOG: baseEnv.CODEMM_HTTP_LOG || "0",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  wireLogs("backend", backendProc);
  backendProc.on("error", (err) => {
    dialog.showErrorBox("Backend Failed To Start", String(err?.message || err));
    app.quit();
  });

  backendProc.on("exit", (code) => {
    if (!app.isQuiting) {
      dialog.showErrorBox(
        "Backend Exited",
        `Codemm backend exited unexpectedly (code=${code ?? "unknown"}). Check terminal logs.`,
      );
      app.quit();
    }
  });

  console.log(`[ide] Waiting for backend health: ${backendUrl}/health`);
  const backendReady = await waitForHttpOk(`${backendUrl}/health`, { timeoutMs: 180_000 });
  if (!backendReady) {
    dialog.showErrorBox(
      "Backend Failed To Start",
      `Backend did not become ready at ${backendUrl}/health within timeout.`,
    );
    killProcessTree(backendProc);
    app.quit();
    return;
  }
  console.log("[ide] Backend is ready");

  // Start frontend dev server (workspace).
  console.log("[ide] Starting frontend (workspace codem-frontend)...");
  frontendProc = spawn("npm", ["--workspace", "codem-frontend", "run", "dev"], {
    cwd: repoRoot,
    env: {
      ...baseEnv,
      PORT: String(DEFAULT_FRONTEND_PORT),
      NEXT_PUBLIC_BACKEND_URL: backendUrl,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  wireLogs("frontend", frontendProc);
  frontendProc.on("error", (err) => {
    dialog.showErrorBox("Frontend Failed To Start", String(err?.message || err));
    app.quit();
  });

  frontendProc.on("exit", (code) => {
    if (!app.isQuiting) {
      dialog.showErrorBox(
        "Frontend Exited",
        `Codemm frontend exited unexpectedly (code=${code ?? "unknown"}). Check terminal logs.`,
      );
      app.quit();
    }
  });

  console.log(`[ide] Waiting for frontend: ${frontendUrl}/`);
  const frontendReady = await waitForHttpOk(`${frontendUrl}/`, { timeoutMs: 180_000 });
  if (!frontendReady) {
    dialog.showErrorBox(
      "Frontend Failed To Start",
      `Frontend did not become ready at ${frontendUrl} within timeout.`,
    );
    killProcessTree(frontendProc);
    killProcessTree(backendProc);
    app.quit();
    return;
  }

  console.log("[ide] Frontend is ready; loading UI...");
  await win.loadURL(frontendUrl);

  const cleanup = () => {
    killProcessTree(frontendProc);
    killProcessTree(backendProc);
  };

  app.on("before-quit", () => {
    app.isQuiting = true;
    cleanup();
  });
}

process.on("uncaughtException", (err) => {
  // Best-effort: surface fatal errors if Electron started from a GUI context.
  try {
    dialog.showErrorBox("Codemm-IDE Crashed", String(err?.stack || err?.message || err));
  } catch {
    // ignore
  }
  // eslint-disable-next-line no-console
  console.error(err);
});

process.on("unhandledRejection", (err) => {
  try {
    dialog.showErrorBox("Codemm-IDE Error", String(err?.stack || err?.message || err));
  } catch {
    // ignore
  }
  // eslint-disable-next-line no-console
  console.error(err);
});

app.whenReady().then(() => {
  console.log("[ide] Electron ready. Booting backend + frontend...");
  return createWindowAndBoot();
});

app.on("window-all-closed", () => {
  // On macOS, typical apps stay open without windows; for an IDE we quit.
  app.quit();
});

app.on("activate", () => {
  // macOS: clicking the dock icon should bring a window back.
  if (mainWindow) {
    mainWindow.show();
    return;
  }
  createWindowAndBoot().catch((err) => {
    try {
      dialog.showErrorBox("Failed To Launch", String(err?.stack || err?.message || err));
    } catch {
      // ignore
    }
  });
});
