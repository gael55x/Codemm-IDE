# Error Handling (Renderer)

This document defines how the renderer should interpret engine/judge errors and recover predictably.

Codemm-IDE is local-only and uses an Electron preload bridge (`window.codemm.*`). There is no internal HTTP API and no SSE.

## IPC call errors

Recommended behavior:

- treat invalid input errors as user-correctable (show message; keep user input; allow retry).
- treat engine lifecycle errors (“Engine unavailable”, “Engine exited”) as terminal and prompt the user to relaunch.
- avoid infinite retry loops; prefer a “Retry” button with a clear error message.

## Generation stream errors

Progress events are delivered via IPC subscription and may stop if:

- the engine exits
- the thread unsubscribes / renderer navigates away

Recommended behavior:

- treat “no progress events yet” as recoverable for a short grace period
- if generation fails, show the terminal `generation_failed` error and keep the thread state

## Judge errors

Judge failures may include compilation errors, test failures, or timeouts.

Recommended behavior:

- render stdout/stderr verbatim (strip ANSI if needed)
- keep the student’s code intact and allow re-run/re-submit
