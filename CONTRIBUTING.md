# Contributing (Codemm-IDE)

Codemm-IDE is an Electron wrapper around the existing repos:

- `../Codemm-backend` (Express + Docker judge)
- `../Codemm-frontend` (Next.js UI)

The goal is a single desktop app experience while keeping backend determinism and Docker-based judging intact.

## Repo Layout

- `main.js` Electron main process (starts backend + frontend, then opens a window)
- `package.json` Electron dev entrypoint
- `docs/` project docs (functions, troubleshooting, handoffs)

## Local Development

1. Ensure Docker Desktop is running.
2. From `Codemm-IDE/`:

```bash
npm install
npm run dev
```

This will:

- start backend via `../Codemm-backend/run-codem-backend.sh`
- start frontend via `../Codemm-frontend/npm run dev`
- open `http://127.0.0.1:3000` inside Electron

## Making Changes

- Desktop wrapper logic: edit `main.js`
- Backend behavior/API/judge: edit files in `../Codemm-backend`
- UI/UX: edit files in `../Codemm-frontend`

Keep in mind:

- Codemm’s “agent logic” is backend-owned; the IDE should remain a thin shell over backend contracts.
- Judging relies on Docker; don’t add a path that executes untrusted code outside Docker.

## Style / Guardrails

- Keep `nodeIntegration: false` and `contextIsolation: true` in Electron.
- Prefer explicit timeouts and clear error dialogs when booting dependencies.
- Avoid hard-coding absolute paths; use environment overrides (`CODEMM_BACKEND_DIR`, `CODEMM_FRONTEND_DIR`) where needed.

