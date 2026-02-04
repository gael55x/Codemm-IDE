# Functions (Codemm-IDE)

This document describes what the desktop wrapper does (and does not do).

## What It Does

- Validates Docker is installed and running (`docker info`).
- Starts `Codemm-backend` as a child process using `../Codemm-backend/run-codem-backend.sh`.
- Waits for backend readiness via `GET /health` (default: `http://127.0.0.1:4000/health`).
- Ensures `Codemm-frontend` dependencies are installed (`npm install` if `node_modules/` is missing).
- Starts `Codemm-frontend` as a child process (`npm run dev`).
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
- `CODEMM_BACKEND_DIR` default `../Codemm-backend`
- `CODEMM_FRONTEND_DIR` default `../Codemm-frontend`
- `DOCKER_PATH` optional path to the `docker` binary (helps for GUI-launched apps with a limited PATH)

## Logging

Child process logs are forwarded to the terminal with prefixes:

- `[backend] ...`
- `[frontend] ...`

## Security Defaults

Electron window is configured with:

- `nodeIntegration: false`
- `contextIsolation: true`

If we add IPC later, we should do it via a strict `preload` bridge with allowlisted channels only.

