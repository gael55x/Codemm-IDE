# Architecture

Codemm Frontend is a Next.js App Router application that runs as the renderer UI inside Codemm-IDE (Electron).

## Key properties

- **Engine-driven orchestration**: the renderer treats the local engine as the source of truth for thread progress and state.
- **Contract-first integration**: the UI relies on stable response fields (`spec`, `questionKey`, progress events) rather than parsing assistant prose.
- **IPC for long-running work**: generation is tracked by subscribing to structured progress events via the preload bridge.

## Repository layout

- `src/app` – Next.js routes:
  - `src/app/page.tsx`: thread UI (create, chat, generate)
  - `src/app/activities/page.tsx`: local activities list
  - `src/app/activity/[id]/page.tsx`: solver UI (editor + run/submit)
  - `src/app/settings/llm/page.tsx`: local API key settings
- `src/components` – reusable UI building blocks
- `src/lib` – client helpers (normalization, language UI helpers)
- `src/types` – type definitions for backend events/payloads

## Integration boundaries

The renderer has two major boundaries:

1) **Threads boundary**: the engine decides what the next question is (`questionKey` + `nextQuestion`).  
2) **Generation/judge boundary**: the engine verifies and grades; the renderer renders progress and results.

Practical implication:

- avoid duplicating engine logic in the renderer (e.g., don’t compute “spec completeness” locally)
- treat engine state as authoritative, and renderer state as a view cache

## Architecture dependencies

- Next.js App Router (React)
- Electron preload bridge (`window.codemm.*`)

See:

- Data flow: `data-flow.md`
