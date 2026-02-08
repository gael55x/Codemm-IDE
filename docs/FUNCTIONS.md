# Functions (Codemm-IDE)

This document describes what the desktop wrapper does (and does not do).

## What It Does

- Validates Docker is installed and running (`docker info`).
- Prompts for a workspace folder on first launch (and persists it).
- Ensures monorepo dependencies are installed (`npm install` in repo root if `node_modules/` is missing).
- Builds judge Docker images if missing (from `apps/backend/Dockerfile.*-judge`).
- Starts the local engine (`apps/backend`) as a child process via Node IPC (`spawn` with `ELECTRON_RUN_AS_NODE=1` → `apps/backend/ipc-server.js`).
- Verifies engine connectivity via an IPC ping (no HTTP ports/health checks).
- Starts `apps/frontend` as a child process:
  - dev: `next dev` via npm workspaces
  - standalone: `apps/frontend/.next/standalone/server.js`
- Waits for frontend readiness by polling a local health route (`/__codemm/health`) and verifying an ephemeral boot token.
- Opens the frontend URL inside an Electron `BrowserWindow`.
- On app quit, terminates both child processes.

## What It Does Not Do (Yet)

- Package into a distributable `.app` bundle.
- Run the frontend in production mode from inside the app bundle (Phase 3 in progress).
- Embed a code editor different from what `Codemm-frontend` already provides.
- Embed the frontend build inside the `.app` bundle (Phase 3).

## Environment Variables

- `CODEMM_FRONTEND_PORT` default `3000`
- `CODEMM_BACKEND_DIR` default `apps/backend`
- `CODEMM_FRONTEND_DIR` default `apps/frontend`
- `CODEMM_FRONTEND_MODE=standalone` forces starting the built Next standalone server (instead of `next dev`) in dev.
- `CODEMM_FRONTEND_TOKEN` internal: ephemeral boot token used only for readiness verification (Electron injects it; do not set manually).
- `CODEMM_ENGINE_USE_DIST=1` forces the engine to load `apps/backend/dist/*` (instead of `ts-node` + `src/*`).
- `DOCKER_PATH` optional path to the `docker` binary (helps for GUI-launched apps with a limited PATH)
- `CODEMM_REBUILD_JUDGE=1` forces rebuilding judge Docker images on launch
- `CODEMM_WORKSPACE_DIR` optional workspace folder override (skips folder picker)
- `CODEMM_DB_PATH` optional path to the backend SQLite DB file (defaults to `<workspaceDataDir>/codemm.db`)
- `CODEMM_DB_DIR` optional directory for the backend DB (used only if `CODEMM_DB_PATH` is not set)
- `CODEMM_OLLAMA_MODEL` optional model name when using `CODEX_PROVIDER=ollama` (local LLM via Ollama)
- `CODEMM_OLLAMA_URL` optional base URL for Ollama (default `http://127.0.0.1:11434`)
- `CODEMM_USER_DATA_DIR` overrides Electron `userData` dir
- `CODEMM_CACHE_DIR` overrides Electron cache dir
- `CODEMM_LOGS_DIR` overrides Electron logs dir

## Logging

Child process logs are forwarded to the terminal with prefixes:

- `[engine] ...`
- `[frontend] ...`

## Security Defaults

Electron window is configured with:

- `nodeIntegration: false`
- `contextIsolation: true`

IPC is implemented via a strict preload bridge with allowlisted channels only (`apps/ide/preload.js`).
