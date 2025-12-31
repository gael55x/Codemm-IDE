# Principles

This backend is structured around a small set of non-negotiable principles. Most “why” questions reduce to one of these.

## 1) Deterministic state transitions

The backend is the source of truth for session state and for what is persisted. State changes must be explainable without referencing prompt text.

Examples:

- Session transitions are defined by an explicit state machine (no hidden transitions).
- “Hard fields” require explicit confirmation before a change is applied.

See `memory-and-state.md`.

## 2) LLM as an untrusted proposal engine

The LLM can propose:

- partial spec changes (patches)
- per-slot problem drafts
- optional user-visible text (assistant message)

The LLM cannot:

- write to the database
- bypass schema validation
- bypass Docker verification
- directly publish un-sanitized content to trace streams

This reduces the blast radius of LLM failures and makes behavior auditable.

## 3) Contracts first

Codem uses strict schemas for the objects that matter:

- `ActivitySpec` (what to generate)
- `GeneratedProblemDraft` (draft, includes reference artifact)
- `GeneratedProblem` (persisted, reference artifact removed)
- generation progress events (what the UI sees)

Contracts are used as:

- **gates** (invalid objects do not cross boundaries),
- **documentation** (the model is the spec),
- **compatibility tools** (additive evolution).

See `state-and-models.md`.

## 4) Verification over trust

Codem does not trust a generated reference solution. It verifies it:

- compile/execute it in Docker under language-specific constraints
- require that it passes the generated test suite

Only after successful verification is a problem eligible for persistence.

See `pipelines/generation.md`.

## 5) User-safe observability

Codem exposes progress and optional trace streams, but with strict redaction:

- no prompts
- no raw generations
- no reference artifacts

Streams are designed to be safe for a learner-facing UI.

See `tools-and-actions.md` and `debugging.md`.

