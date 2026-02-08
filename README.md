<div align="center">
  <h1>Codemm</h1>
  <p>Codemm is a local-only Electron IDE that turns a short chat into verified programming activities (problems + tests) and grades solutions in Docker sandboxes.</p>
  <img src="./apps/frontend/images/Codemm-home.png" alt="Codemm home" width="900" />
</div>

## What Codemm Is (IDE-First)

Codemm runs entirely on your machine:

- No authentication, accounts, profiles, or community features.
- A **workspace** (folder on disk) owns all durable state.
- A **thread** is a local conversation that produces an `ActivitySpec`.
- A **run** is an append-only execution log (generation / judge), used for replay + debugging.
- An **activity** is the output you practice: learner-facing problems + tests, verified in Docker.

Design goals:

- Determinism at boundaries (LLM proposes; deterministic code validates/gates/persists).
- Debuggability (durable run logs and reproducible state).
- Safety (untrusted code runs in Docker only).

## High-Level Architecture

Processes (today):

- **Electron main** (`apps/ide/main.js`): boot orchestration, workspace selection, secrets handling, IPC bridge.
- **Local engine** (`apps/backend`): agent loop + SQLite persistence + Docker judge. Exposes RPC via Node IPC (`process.send`).
- **Renderer UI** (`apps/frontend`): Next.js UI loaded inside Electron; uses `window.codemm.*` via a preload allowlist (`apps/ide/preload.js`).

There is no internal HTTP API for engine calls. UI → engine is IPC only.

## Local State & Persistence

- Per-workspace DB: `<workspaceDataDir>/codemm.db` (preferred: `<workspace>/.codemm/codemm.db`)
- Key tables (IDE-first): `threads`, `thread_messages`, `activities`, `runs`, `run_events`

## Security Model (Practical)

- **Docker is the sandbox boundary** for untrusted code execution/judging.
- Electron hardening:
  - `nodeIntegration: false`, `contextIsolation: true`
  - strict preload allowlist (`window.codemm.*`) with payload validation
- Secrets:
  - stored locally via Electron `safeStorage` (encrypted at rest)
  - never returned to renderer JS
  - engine is configured in-memory on boot via IPC (API keys are not passed via environment variables)
- Renderer loading:
  - UI is served from localhost (transitional) and verified via `GET /__codemm/health` + an ephemeral boot token before the Electron window loads it (mitigates localhost port hijacking).

## No API Key? Use Ollama (Local Model)

If you can’t use a paid API key, Codemm can use a local model via Ollama:

1) Install Ollama and start it (it runs on `http://127.0.0.1:11434`).
2) Pull a model (examples: `qwen2.5-coder:7b` for lighter machines, `qwen2.5-coder:14b` for higher quality if you have RAM).
3) In Codemm → **API Key** settings:
   - Provider: `Ollama (local)`
   - Model: your pulled model name (e.g. `qwen2.5-coder:7b`)

## Development

Requirements:

- macOS
- Node.js + npm
- Docker Desktop (running)

Run:

```bash
npm install
npm run dev
```

On first launch, pick a workspace folder. Configure your LLM API key via the **API Key** screen in the UI.

## Packaging (macOS)

```bash
npm install
npm run dist:mac
```

`dist:mac` rebuilds native deps for Electron automatically (notably `better-sqlite3`).

## Docs Index

- IDE-first mental model + topology: `docs/architecture/IDE_FIRST.md`
- Migration phases: `docs/architecture/MIGRATION.md`
- Wrapper behavior: `docs/FUNCTIONS.md`
- Security notes: `docs/SECURITY.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Contributing: `CONTRIBUTING.md`

## Environment Overrides (Dev)

- `CODEMM_FRONTEND_PORT` (default `3000`)
- `CODEMM_FRONTEND_MODE=standalone` (use built Next standalone server in dev)
- `CODEMM_ENGINE_USE_DIST=1` (force engine `dist/*` instead of `ts-node`)
- `DOCKER_PATH` (explicit docker binary path)
- `CODEMM_WORKSPACE_DIR` (skip workspace picker)
- `CODEMM_DB_PATH` (override DB file path)
