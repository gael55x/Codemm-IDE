# Migration Phases (IDE-First)

This repo (`Codemm-IDE/`) is the single source of truth.

## Phase 0 (Done)

- Consolidate work into `Codemm-IDE` monorepo (already the case).

## Phase 1: Remove Auth + Users + Community (Done)

- Delete auth/account flows from engine + UI.
- Delete community/profile features from engine + UI.
- Replace “sessions” with local **threads**:
  - UI uses `/threads`
  - engine keeps `/sessions` only as a **transitional alias**

## Phase 2 (In Progress): Remove HTTP/Express/SSE Boundary

Transitional → final:

- Introduce a local engine **IPC server** (child process) and migrate UI calls off HTTP.
- Replace UI `fetch()` / `EventSource` calls to `127.0.0.1` with:
  - IPC calls (`ipcRenderer.invoke`) and event streams, or
  - in-process calls if the engine runs inside Electron main
- Remove:
  - backend ports/health checks/backend URLs
  - Express routes and SSE adapters (delete once all call sites use IPC)

## Phase 3 (Next): Renderer Build Embedded in App

- Stop relying on `next dev` + `nodemon` child processes in dev-like mode.
- Package production builds into the `.app` bundle.

## Transitional Compatibility Rules

Allowed temporarily (must be removed):

- HTTP endpoints on localhost.
- `/sessions` route alias (use `/threads` everywhere).
- “sessions” table name in SQLite (thread storage will be renamed once IPC replaces HTTP).
