# Overview

Codemm Frontend is the Next.js renderer UI that runs inside Codemm-IDE (Electron).

- create and continue threads (the spec-building loop)
- generate activities once a thread spec is ready
- solve activities and run/submit code against the local Docker judge
- browse locally generated activities (“Your activities”)

## What the frontend does (and does not do)

The renderer is responsible for UX, not decision-making:

- It **does**:
  - send user messages to the local engine (via `window.codemm.*`)
  - render `nextQuestion` and `questionKey`
  - render a view of the current spec snapshot
  - subscribe to generation progress via IPC event stream
  - call local judge actions (`judge.run`, `judge.submit`) and render results
  - provide a local API key settings screen (the key is not exposed to renderer JS)
- It **does not**:
  - infer spec gaps or next questions locally
  - apply patches to durable state
  - validate reference artifacts (Docker verification is backend-only)

This split ensures consistency across clients and makes backend behavior auditable.

## Where the “agent” lives

The agentic logic (planning, gating, validation, retries) is implemented in the local engine (`apps/backend`).
