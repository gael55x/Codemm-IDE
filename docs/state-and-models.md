# State and Models

This document summarizes the key persisted state and the contracts that flow through the system. It is a “map”, not a full schema listing.

## Core contracts

### `ActivitySpec`

Represents “what to generate”. It includes:

- `language` (`java`/`python`/`cpp`/`sql`)
- `problem_count` (Codem v1: 1–7)
- `difficulty_plan` (must sum to problem count)
- `topic_tags`
- `problem_style`
- `constraints` (must match language default constraints)
- `test_case_count` (Codem v1: exactly 8)

The contract is strict by design: it is the boundary between session loop and generation.

### `GeneratedProblemDraft` and `GeneratedProblem`

Generation uses a two-stage model:

- `GeneratedProblemDraft`: includes reference artifacts required for verification.
- `GeneratedProblem`: the persisted model where reference artifacts have been removed.

Key invariant:

- Reference artifacts must not be persisted.

### Generation progress events

The backend emits structured events over SSE to support a reliable progress UI. Event schemas are designed to evolve additively.

See `api/backend.md`.

## Session state

Sessions have an explicit state machine:

- `DRAFT`: initial state
- `CLARIFYING`: agent is collecting missing fields / resolving inconsistencies
- `READY`: spec is complete and supported for generation
- `GENERATING`: generation in progress
- `SAVED`: activity persisted
- `FAILED`: generation failed (may allow returning to `READY`)

The state machine is a contract: clients and developers should be able to reason about which actions are valid in each state.

## Persistence model (SQLite)

SQLite stores:

- `users`: accounts and optional per-user LLM key config
- `sessions`: state, spec JSON, metadata
- `session_collectors`: pending confirmation buffers and question keys
- `session_messages`: conversation history
- `activities`: persisted activities (including problems JSON)
- `submissions`: outcomes for authenticated users
- `learner_profiles`: deterministic mastery signals

Where models are stored as JSON strings, the backend treats the corresponding Zod contract as authoritative for the logical shape.

## Frontend-backend contract boundary

Clients should treat:

- backend `spec` snapshots as the canonical representation of the draft
- backend `questionKey` as the canonical “what to ask/confirm next”
- backend progress events as the canonical generation progress

Client-side derived state should be considered a view cache, not a source of truth.

