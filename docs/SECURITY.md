# Security Notes (Codemm-IDE)

## Threat Model (Practical)

- Renderer is untrusted content relative to the OS.
- Codemm runs/grades untrusted user code; **Docker is the sandbox boundary**.
- The Electron app must not become a path to local code execution outside Docker.

## Electron Hardening Checklist

- BrowserWindow:
  - `nodeIntegration: false`
  - `contextIsolation: true`
  - no `remote` module
- Navigation control:
  - only load the local frontend URL
  - block unexpected navigations/new windows
  - mitigate localhost port hijacking by verifying the frontend health token before loading
- IPC:
  - use `preload` with minimal surface area
  - validate all inputs
  - do not expose filesystem/network primitives directly to the renderer

## Secrets

- Avoid storing provider API keys in the renderer.
- Current: Electron main stores keys locally using `safeStorage` and exposes only a minimal preload bridge.
- Target: OS keychain integration (macOS Keychain) with per-workspace overrides.

Local model option:

- Ollama runs on localhost and requires no API key, but it is still a local network boundary.
- Codemm only calls the Ollama endpoint from the engine process (renderer does not receive model credentials).

## Docker Boundary

- All compilation/execution/judging remains in Docker.
- The IDE should never run submitted code directly via `child_process` outside Docker.

## Localhost Port Hijacking (Transitional)

Codemm-IDE currently serves the renderer UI from a local Next.js server (127.0.0.1).

Threat:

- If the IDE loads an unexpected page (wrong port, hijacked port, unrelated local service), that page would still be running inside the Electron renderer and could call the preload bridge.

Mitigation (current):

- Electron main verifies it is talking to the frontend server it started by polling `GET /__codemm/health` and checking an ephemeral token set via `CODEMM_FRONTEND_TOKEN`.

Target (final):

- Remove localhost serving entirely (embed assets via custom protocol / file-based loading).
