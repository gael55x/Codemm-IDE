# IDE-First Architecture (Codemm-IDE)

Codemm-IDE is a local-only Electron app. There is no authentication, no accounts, no community features, and no server-owned sessions.

## Mental Model

- **Workspace**: a folder on disk the user opens.
- **Thread**: a local conversation + spec-building state (formerly “session”).
- **Run**: an immutable log of an execution (generation / judge), used for replay + debugging.

Diagram:

```
Workspace (folder)
  ├─ Threads
  │    ├─ Messages
  │    ├─ Spec draft + deterministic state machine
  │    └─ Run logs (generation/judge events)
  └─ Activities
       └─ Problems + tests (Docker-verified)
```

## Runtime Topology

Current:

- **Electron main** (`apps/ide/main.js`)
  - selects workspace folder
  - stores secrets locally
  - starts local engine + UI as child processes (dev mode)
- **Local engine** (`apps/backend`)
  - deterministic agent loop + Docker judge + SQLite persistence
  - exposes an in-process RPC surface via Node IPC (`fork` + `process.send`)
- **Renderer UI** (`apps/frontend`)
  - renders threads/activities
  - calls the local engine via `window.codemm.*` (preload IPC allowlist)

Target (final):

- Embed the frontend build inside the `.app` bundle (remove the Next dev server in dev-like mode).
- Optionally run the engine in-process in Electron main if it stays deterministic and debuggable.

## Local State Ownership & Persistence

- The **workspace** owns all durable state.
- The IDE chooses a per-workspace data directory:
  - preferred: `<workspace>/.codemm/` (portable)
  - fallback: Electron `userData/Workspaces/<hash>/` (for read-only workspaces)
- The engine DB path is set via `CODEMM_DB_PATH` to: `<workspaceDataDir>/codemm.db`.

## Threads (Replacing Sessions)

- “Sessions” are not server resources. They are **local threads** scoped to a workspace.
- Transitional compatibility:
  - legacy workspaces are migrated in-place from `sessions*` tables to `threads*` on engine startup

## API Key Handling & Scoping

- API keys are stored locally by Electron main using `safeStorage` (encrypted at rest).
- Renderer accesses key status via a minimal preload bridge:
  - `window.codemm.secrets.getLlmSettings()`
  - `window.codemm.secrets.setLlmSettings({ provider, apiKey })`
  - `window.codemm.secrets.clearLlmSettings()`
- Engine receives the key via environment variables on launch (transitional).
  - Changing the key currently requires restarting the IDE (transitional).

## Deleted SaaS Concepts (By Design)

- Auth routes (`/auth/*`), JWTs, users table, passwords.
- Profile routes (`/profile*`) and per-user settings stored in SQLite.
- Community routes (`/community/*`) and community publish/unpublish behavior.
