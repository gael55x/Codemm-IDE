# Data Flow

This document describes how data moves through the backend at runtime. It is intentionally framed in terms of **contracts** and **state transitions**, not prompt text.

## 1) Session loop (chat → `ActivitySpec`)

The frontend drives the loop via `POST /sessions/:id/messages`.

High-level flow:

1. **Input validation**: validate request shape (`message` is a non-empty string).
2. **Load session**: session record + collector state + commitments + history.
3. **Deterministic normalization**:
   - ensure fixed fields (`version`, `test_case_count`, language constraints)
   - parse low-entropy shorthands (e.g., difficulty shorthand)
4. **LLM turn**:
   - LLM proposes a partial patch and an assistant message (best-effort).
5. **Deterministic apply**:
   - convert proposal into JSON Patch ops
   - apply patch to spec draft
   - validate resulting draft (partial specs are allowed; invalid fields are rejected)
6. **Confirmation gate (if required)**:
   - for certain “hard fields”, changes may require explicit user confirmation
   - pending patch is stored in the collector buffer until confirmed
7. **Commitments update**:
   - once a user decision is considered “committed”, it is locked to reduce churn
8. **Next question selection**:
   - derive `questionKey` and `nextQuestion` deterministically from spec gaps
9. **Persist**:
   - store the updated session, collector, commitments, and conversation message(s)

Outputs:

- `spec` (draft spec snapshot)
- `questionKey` and `nextQuestion`
- `done` (true when READY for generation)

Related docs:

- State machine: `agentic-design/memory-and-state.md`
- Guardrails: `agentic-design/guardrails-and-validation.md`

## 2) Generation (validated spec → persisted activity)

The frontend triggers generation with `POST /sessions/:id/generate` (auth required).

High-level flow:

1. **State gate**: session must be `READY`.
2. **Validate full spec**: `ActivitySpec` must satisfy the strict schema.
3. **Plan**: derive a deterministic `ProblemPlan` (slot list).
4. **Per-slot generation** (repeated for each slot):
   - emit progress events
   - call LLM to generate a `GeneratedProblemDraft`
   - validate contract (schema)
   - validate reference artifact in Docker (compile + tests)
   - optionally apply Guided scaffolding (deterministic, after verification)
   - discard reference artifacts
5. **Persist**:
   - store the resulting activity and problems in SQLite
   - store generation outcomes for audit/debug
6. **Finalize**:
   - session transitions to `SAVED` (or `FAILED`)

Progress reporting:

- `GET /sessions/:id/generate/stream` streams structured progress events.
- Optional `GET /sessions/:id/trace` streams sanitized trace events (when enabled).

Related docs:

- Generation pipeline: `pipelines/generation.md`
- Failure modes and recovery: `agentic-design/failure-modes.md`

## 3) Execution and grading

### `/run` (execution-only)

- Purpose: run code without tests (no persistence).
- Inputs: `language` + either `code` or `files`, optional `stdin`.
- Guardrails:
  - size limits and filename patterns
  - language must be supported for execution
- Outputs: `stdout`, `stderr`.

### `/submit` (graded)

- Purpose: run code against a provided `testSuite`.
- Inputs: `language`, `testSuite`, and either `code` or `files`; optional `activityId` + `problemId`.
- Guardrails:
  - language must be supported for judging
  - size limits and filename patterns
  - file-mode restrictions per language (e.g., C++ supports `solution.cpp` + headers)
- Outputs: judge result (pass/fail, tests, output, timing).

If the request is authenticated and includes a valid `activityId`/`problemId` owned by the user, the backend persists a submission record and deterministically updates the learner profile.

Related docs:

- Grading pipeline: `pipelines/grading.md`
- Feedback loop: `pipelines/feedback.md`

