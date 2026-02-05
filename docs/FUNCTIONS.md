# Functions (Codemm-IDE)

This document describes what the desktop wrapper does (and does not do).

## What It Does

- Validates Docker is installed and running (`docker info`).
- Ensures monorepo dependencies are installed (`npm install` in repo root if `node_modules/` is missing).
- Builds judge Docker images if missing (from `apps/backend/Dockerfile.*-judge`).
- Starts `apps/backend` as a child process (via npm workspaces).
- Waits for backend readiness via `GET /health` (default: `http://127.0.0.1:4000/health`).
- Starts `apps/frontend` as a child process (via npm workspaces).
- Waits for frontend readiness (default: `http://127.0.0.1:3000/`).
- Opens the frontend URL inside an Electron `BrowserWindow`.
- On app quit, terminates both child processes.

## What It Does Not Do (Yet)

- Package into a distributable `.app` bundle.
- Run frontend/backend in production mode from inside the app bundle.
- Embed a code editor different from what `Codemm-frontend` already provides.

## Environment Variables

- `CODEMM_BACKEND_PORT` default `4000`
- `CODEMM_FRONTEND_PORT` default `3000`
- `CODEMM_BACKEND_DIR` default `apps/backend`
- `CODEMM_FRONTEND_DIR` default `apps/frontend`
- `DOCKER_PATH` optional path to the `docker` binary (helps for GUI-launched apps with a limited PATH)
- `CODEMM_REBUILD_JUDGE=1` forces rebuilding judge Docker images on launch
- `CODEMM_DB_PATH` optional path to the backend SQLite DB file (the IDE sets this to `<userData>/codem.db` by default)
- `CODEMM_DB_DIR` optional directory for the backend DB (used only if `CODEMM_DB_PATH` is not set)
- `CODEMM_USER_DATA_DIR` overrides Electron `userData` dir
- `CODEMM_CACHE_DIR` overrides Electron cache dir
- `CODEMM_LOGS_DIR` overrides Electron logs dir

## Logging

Child process logs are forwarded to the terminal with prefixes:

- `[backend] ...`
- `[frontend] ...`

## Security Defaults

Electron window is configured with:

- `nodeIntegration: false`
- `contextIsolation: true`

If we add IPC later, we should do it via a strict `preload` bridge with allowlisted channels only.
