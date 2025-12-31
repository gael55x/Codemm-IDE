# Frontend / Client Integration Notes

This document describes backend behaviors that matter when building clients (including the Codem frontend). It complements `backend.md` and focuses on contracts, invariants, and operational expectations.

## Backend URL configuration

The official frontend uses `NEXT_PUBLIC_BACKEND_URL` and falls back to `http://localhost:4000`.

Clients should treat the backend as the source of truth for:

- session state
- spec snapshots
- progress events

## Session loop semantics

Key properties clients should rely on:

- `questionKey` is server-selected; clients should not infer missing fields from raw assistant text.
- `spec` is a snapshot; treat it as informational unless you are building an advanced spec editor.
- `done=true` indicates the session is ready for generation.
- Confirmation is encoded in `questionKey` (e.g., a `confirm:`-prefixed value); clients should render confirmation UX when required.

## Progress SSE semantics

The generation progress stream:

- can replay buffered events (clients may connect after generation starts)
- emits heartbeats to keep the connection alive
- ends after a completion/failure terminal event

Clients should:

- tolerate additive evolution of event types
- handle reconnects without duplicating UI state (use slot indices / activityId)

## Trace SSE semantics

Trace is optional and feature-flagged.

Clients should:

- expect 404 when trace is disabled
- treat trace as debugging-only; it is not a stable product contract

## Code and test suite handling

For `/run` and `/submit`, clients should respect:

- filename restrictions (e.g., `solution.py`, `solution.cpp`, `solution.sql` in file-mode submissions)
- size limits and file count limits
- language support differences between execution and judging

If you add support for new file layouts in clients, ensure backend validation matches those assumptions.

