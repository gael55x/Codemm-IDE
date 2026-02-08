# Data Flow (Renderer)

This document describes renderer workflows and how they map to the IDE bridge (`window.codemm`).

Codemm-IDE is local-only: no auth, no accounts, no community browsing, no internal HTTP API.

## 1) Start a thread

Workflow:

1. `window.codemm.threads.create({ learning_mode })`
2. Render the returned `nextQuestion` and initialize the chat transcript.

Invariant:

- the engine controls thread state; the renderer does not invent state locally.

## 2) Send a message (spec-building loop)

Workflow:

1. `window.codemm.threads.postMessage({ threadId, message })`
2. Render:
   - assistant response (`nextQuestion`)
   - returned `questionKey` (UI’s next “prompt target”)
   - current `spec` snapshot (optional UI panel)
3. Continue until `done=true`.

Invariant:

- `questionKey` is authoritative. The renderer should not parse assistant prose to infer what to ask next.

## 3) Optional: custom generation focus

Workflow:

- `window.codemm.threads.setInstructions({ threadId, instructions_md })`

Notes:

- `instructions_md` is persisted locally in the workspace DB and is used as a best-effort shaping signal during generation.
- Do not include secrets.

## 4) Generate an activity (long-running)

Workflow:

1. Subscribe: `window.codemm.threads.subscribeGeneration({ threadId, onEvent })`
2. Trigger: `window.codemm.threads.generate({ threadId })`
3. Update UI based on structured progress events:
   - slot started
   - contract validated/failed
   - Docker validation started/failed
   - slot completed
   - generation completed/failed

Invariants:

- progress events are append-only and replayable; ignore unknown event types.
- dedupe by `slotIndex` + event type if needed.

## 5) List and solve activities

Workflow:

1. List: `window.codemm.activities.list({ limit })`
2. Load: `window.codemm.activities.get({ id })`
3. Provide run/submit actions:
   - `window.codemm.judge.run(...)` for fast execution-only
   - `window.codemm.judge.submit(...)` for graded submission with tests

Invariant:

- the judge is the source of truth for correctness; do not simulate test results in the renderer.
