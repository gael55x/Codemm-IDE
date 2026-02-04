# Contributing (Codemm-IDE)

Codemm-IDE is an Electron wrapper around the in-repo apps:

- `apps/backend` (Express + Docker judge)
- `apps/frontend` (Next.js UI)

The goal is a single desktop app experience while keeping backend determinism and Docker-based judging intact.

## Repo Layout

- `apps/ide/main.js` Electron main process (starts backend + frontend, then opens a window)
- `package.json` npm workspaces root + scripts
- `apps/ide/package.json` Electron dev entrypoint
- `docs/` project docs (functions, troubleshooting, handoffs)

## Local Development

1. Ensure Docker Desktop is running.
2. From `Codemm-IDE/`:

```bash
npm install
npm run dev
```

Note: this is an npm workspaces monorepo. Use the repo root for installs; do not maintain per-app lockfiles.

This will:

- start backend from `apps/backend`
- start frontend from `apps/frontend`
- open `http://127.0.0.1:3000` inside Electron

## Making Changes

- Desktop wrapper logic: edit `main.js`
- Backend behavior/API/judge: edit files in `apps/backend`
- UI/UX: edit files in `apps/frontend`

Keep in mind:

- Codemm’s “agent logic” is backend-owned; the IDE should remain a thin shell over backend contracts.
- Judging relies on Docker; don’t add a path that executes untrusted code outside Docker.

## Style / Guardrails

- Keep `nodeIntegration: false` and `contextIsolation: true` in Electron.
- Prefer explicit timeouts and clear error dialogs when booting dependencies.
- Avoid hard-coding absolute paths; use environment overrides (`CODEMM_BACKEND_DIR`, `CODEMM_FRONTEND_DIR`) where needed.
