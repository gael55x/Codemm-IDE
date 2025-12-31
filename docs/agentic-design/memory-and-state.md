# Memory and State

Codem Backend maintains multiple “memory” layers. Each layer has a distinct purpose and a distinct set of invariants.

This separation matters because it avoids conflating:

- what the user asked for,
- what the system has decided,
- what the system is currently doing,
- what should influence future work.

## 1) Short-term memory: current turn inputs

- The incoming user message for `POST /sessions/:id/messages`
- Any transient parsing results for that message (e.g., a shorthand parse)

Invariants:

- short-term memory is not authoritative
- it must be safe to discard without changing durable semantics

## 2) Session memory: the session record

The session record is the backend’s durable representation of “where we are” in the workflow.

Key components:

- `state`: a strict state machine (`DRAFT`, `CLARIFYING`, `READY`, `GENERATING`, `SAVED`, `FAILED`)
- `spec`: the current spec draft (eventually a validated `ActivitySpec`)
- `messages`: conversation history (user + assistant)
- `collector`: buffer for pending confirmation state
- `commitments`: persisted locks to prevent churn
- `confidence` / `intentTrace`: additive metadata used for debugging and/or UX (must remain safe and non-authoritative)

Invariants:

- state transitions are explicit and validated
- `spec` is always locally correct for any present fields (draft schema)
- only deterministic code may update the session record

## 3) Long-term memory: persisted user data

The backend persists long-lived data beyond a single session:

- `users`: accounts and (optionally) per-user LLM key config
- `activities`: generated activities and problems
- `submissions`: execution outcomes for authenticated users
- `learner_profiles`: deterministic per-user, per-language mastery and recent failures

Invariants:

- learner profile updates are deterministic and must not change judging semantics
- per-user LLM keys are encrypted at rest when enabled (and should not be logged)

## 4) “Memory” in the LLM

The model itself has no durable memory. It only receives the context the backend chooses to provide.

Practical consequence:

- if something must be stable and auditable, it must live in persisted state (spec/commitments), not in prompt continuity.

## Collector buffer and confirmation gating

The “collector” exists to support confirmation gating:

- some changes are staged but not applied until the user explicitly confirms
- the pending patch is stored in the collector buffer
- a short confirmation message (“yes”, “confirm”, etc.) deterministically applies the patch

This is a loop-prevention mechanism: it reduces flip-flopping on hard fields and prevents silent changes.

See `guardrails-and-validation.md` for how confirmation interacts with validation.

