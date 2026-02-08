# Renderer API

The renderer’s public surface for engine interactions is `window.codemm` (Electron preload).

Key namespaces:

- `window.codemm.threads` – threads (create/list/get/postMessage/generate + generation stream)
  - includes `setInstructions({ threadId, instructions_md })` for per-thread generation focus
- `window.codemm.activities` – activity load/edit/publish
  - includes `list({ limit })` for local activity navigation
- `window.codemm.judge` – Docker-backed `/run` and `/submit` equivalents
- `window.codemm.secrets` – local API key settings (no key is ever returned to the renderer)
- `window.codemm.workspace` – workspace selection/info
