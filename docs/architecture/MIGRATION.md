# Migration Phases (IDE-First)

This repo (`Codemm-IDE/`) is the single source of truth.

## Phase 0 (Done)

- Consolidate work into `Codemm-IDE` monorepo (already the case).

## Phase 1: Remove Auth + Users + Community (Done)

- Delete auth/account flows from engine + UI.
- Delete community/profile features from engine + UI.
- Replace “sessions” with local **threads**:
  - UI uses `threads.*` IPC APIs
  - engine stores state in `threads` table

## Phase 2 (Done): Remove HTTP/Express/SSE Boundary

Transitional → final:

- Introduce a local engine **IPC server** (child process) and migrate UI calls off HTTP.
- Replace UI `fetch()` / `EventSource` calls to `127.0.0.1` with:
  - IPC calls (`ipcRenderer.invoke`) and event streams, or
  - in-process calls if the engine runs inside Electron main
- Remove:
  - backend ports/health checks/backend URLs
  - Express routes and SSE adapters (delete once all call sites use IPC)

Status (as of 2026-02-07):
- UI call sites migrated to IPC (no `fetch()`/`EventSource` to engine).
- Engine boots via IPC (no backend port/health).
- Express/SSE server code deleted from `apps/backend`.

## Phase 3 (In Progress): Renderer Build Embedded in App

- Stop relying on `next dev` + `nodemon` child processes in dev-like mode.
- Package production builds into the `.app` bundle.
- Use Next standalone output (`apps/frontend/.next/standalone/server.js`) for packaged runs.

Status (as of 2026-02-08):
- Frontend builds produce a standalone bundle (`output: "standalone"` + `prepare-standalone`).
- IDE can boot the standalone frontend server when packaged (or when `CODEMM_FRONTEND_MODE=standalone`).
- Packaged runs force the engine to load compiled `dist` (`CODEMM_ENGINE_USE_DIST=1`).
- Packaging rebuilds native deps for Electron (`npm run dist:mac` runs `npm run rebuild:electron`).

## Transitional Compatibility Rules

Allowed temporarily (must be removed):

- Next dev server on localhost (UI only).
- API key changes require IDE restart (temporary).
