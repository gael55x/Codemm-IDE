# Codemm-Desktop: Agent Instructions

This file defines maintainability + security rules for work in this repository.

## Goals

- Ship a cross-platform desktop app (macOS / Windows / Linux) that feels like the existing `Codemm-frontend` UI.
- The desktop app must start everything needed locally:
  - local engine (agent loop + persistence)
  - frontend UI
  - Docker-based judge (external dependency)
- Keep Codemm’s safety property intact: untrusted code execution stays inside Docker (never in Electron).

## Repo Boundaries (Today)

- This repo is a monorepo:
  - `apps/ide` Electron wrapper
  - `apps/backend` local engine (agent loop + Docker judge + SQLite)
  - `apps/frontend` frontend UI (Next.js)
- The Electron wrapper starts engine + frontend as child processes (see `apps/ide/main.js`) and bridges UI→engine via a preload allowlist (`apps/ide/preload.js`).

Near-term direction: bundle backend + frontend into the packaged app (no separate terminals, no system Node required).

## System Invariants (Must Remain True)

- **No untrusted code runs on the host**:
  - learner `/run` + `/submit` and generation-time reference validation must execute in Docker only.
  - no “fallback” path that runs untrusted code via `child_process` outside Docker.
- **Engine API is IPC-only**:
  - renderer → engine must go through preload allowlist → Electron main → Node child IPC.
  - do not add an HTTP API surface for the engine without an explicit security review and a clear need.
- **Reference artifacts must not persist**:
  - generation uses hidden `reference_solution` / `reference_workspace` only for Docker validation.
  - these artifacts must be discarded before writing `activities.problems` to SQLite.
- **Secrets never reach renderer JS**:
  - renderer can read only “configured/provider/model/updatedAt”-style status.
  - API keys must never be returned to renderer or written to logs.
- **Local-only by default**:
  - workspace owns all durable state (threads, activities, runs, submissions).
  - no auth/accounts/community concepts.

## Dev Commands

- Run the IDE (dev): `npm run dev`
- Port (dev UI):
  - frontend: `CODEMM_FRONTEND_PORT` (default `3000`)
  - engine: **no HTTP port** (IPC only)

## Required Practices

- Incremental commits and pushes.
- Every iteration must update the handoff doc for the day:
  - `docs/handoff/YYYY-MM-DD.md`
  - Append an entry under the "Iteration Log" for that day.
  - Include: what changed, how to run, known issues, next steps.
- Keep docs current:
  - `README.md` (run + high-level)
  - `CONTRIBUTING.md` (workflow + repo layout)
  - `docs/FUNCTIONS.md` (what the wrapper does)
  - `docs/TROUBLESHOOTING.md` (actionable fixes)

## Maintainability Rules (Senior SWE Defaults)

- **Single source of truth per layer**:
  - renderer is UI-only; engine owns persistence + agent loop; Electron main owns boot + secrets + navigation security.
  - avoid duplicating “business rules” across renderer and engine; prefer engine as source of truth.
- **Contract-first boundaries**:
  - validate at the boundary (Zod or equivalent) before side effects (DB writes, Docker runs).
  - keep payload sizes bounded (code, test suites, logs). Reject oversized inputs with clear errors.
- **IPC discipline**:
  - new surface area must be: preload allowlist → Electron main handler → engine method.
  - keep naming stable (`codemm:*` channels; `threads.*`, `activities.*`, `judge.*`, `engine.*` methods).
- **Determinism at boundaries**:
  - LLM output is never trusted directly; it must be parsed, validated, and reduced deterministically (schemas + invariants).
  - prefer temperature 0 for “spec patch” style calls; allow higher temperature only where diversity is the goal (generation).

## Electron Security Rules (Non-Negotiable Defaults)

- Keep `nodeIntegration: false` and `contextIsolation: true`.
- Do not load arbitrary remote content.
  - The BrowserWindow should load only the local frontend URL.
- Mitigate localhost renderer risks (transitional):
  - verify renderer identity before loading (health token check).
  - block unexpected navigations/new windows; open external links via `shell.openExternal`.
- If IPC is added:
  - use a `preload` bridge
  - allowlist channels
  - validate payloads (zod or equivalent)
- Never pass secrets via renderer JS.
  - Keep secrets in Electron main (encrypted at rest) and configure engine in-memory via IPC.

## Data & Persistence Rules

- **SQLite schema ownership**:
  - engine owns schema + migrations (`apps/backend/src/database.ts`).
  - migrations must be forward-only and safe for existing workspaces.
- **Workspace scoping**:
  - durable state must be per-workspace (DB lives under `<workspaceDataDir>/codemm.db`).
  - do not write durable app state to repo-relative paths except under `.codemm/` in the selected workspace.
- **Runs are append-only logs**:
  - generation/judge should log progress/results to `runs` + `run_events` for replay/debug.
  - keep logs sanitized (no secrets; truncate long outputs).

## Docker/Judge Rules

- Docker Desktop is required.
- The IDE should detect “Docker missing/not running” and show a clear, actionable message.
- The judge must remain Docker-sandboxed:
  - no “fallback” path that executes untrusted code locally.
- Docker invocations:
  - use `spawn(cmd, args[])` (no shell strings) and enforce timeouts + output limits.
  - containers must run with networking disabled and a read-only filesystem where possible.

## Reliability & Observability

- **Fast failure + clear errors**:
  - failures should propagate as actionable messages (missing Docker, missing LLM config, invalid inputs).
  - redact secrets in crash/error dialogs and logs.
- **Progress visibility for long work**:
  - generation must stream structured progress events (no prompts, no raw reference solutions).
  - the engine should persist progress checkpoints when possible (resume on restart is allowed only if safe).
- **Quality gates must be deterministic**:
  - do not add “semantic” validation (topic focus, difficulty realism) unless it is deterministic, documented, and testable.

## Testing Expectations

- Add/extend tests when changing:
  - schema contracts (`contracts/*`)
  - persistence/migrations (`database.ts`)
  - IPC request handling (shape/limits/error paths)
  - Docker judge invocation behavior (timeouts, sandbox flags, file validation)
- Prefer integration tests for end-to-end flows:
  - thread → generate → activity persisted
  - judge run/submit with representative code inputs

## Packaging Requirements (Target State)

When we say “bundled”, we mean:

- end-user installs a native desktop artifact (`.app`/`.dmg`, `.exe`, AppImage, etc)
- double-click launches
- no `npm install`, no separate terminals
- backend + frontend run from inside the app bundle
- native deps (e.g., `better-sqlite3`) are rebuilt for Electron
