# Generation Pipeline

This document describes the backend generation pipeline: **validated spec → planned slots → per-slot drafting → contract validation → Docker verification → persistence**.

The generation entrypoint is `POST /sessions/:id/generate` (auth required).

## Inputs

Generation consumes a session whose spec is a valid `ActivitySpec`:

- language (`java`, `python`, `cpp`, `sql`)
- problem count (1–7)
- difficulty plan (sums to problem count)
- topic tags
- problem style (string; normalized by generators)
- constraints (must match language default constraints)
- test case count (Codem v1 requires exactly 8)

See `../state-and-models.md`.

## Stage 1: Plan derivation (deterministic)

Derive a `ProblemPlan` (list of slots) from the `ActivitySpec`.

Properties:

- deterministic ordering
- deterministic topic distribution
- slot schema validation (plan is itself contract-validated)

Optional Guided Mode behavior:

- a pedagogy policy can annotate slots with `pedagogy` metadata (scaffold level, learning goal, hints enabled)
- this annotation must not change verification semantics

See `../agentic-design/planners.md`.

## Stage 2: Per-slot drafting (LLM)

For each slot:

1. Build a slot prompt (includes slot constraints and context).
2. Call the LLM to produce a `GeneratedProblemDraft`.

Important:

- LLM output is untrusted input.
- It must pass contract validation before any tool execution.

## Stage 3: Contract validation (deterministic)

Validate `GeneratedProblemDraft`:

- required fields exist (title/description/test suite/etc.)
- test suite adheres to strict rules per language (including exactly 8 tests)
- if a “workspace” draft is produced, file layout and markers must satisfy the workspace contract

If validation fails:

- the slot is retried (bounded retries)
- repair context may include prior failure details

## Stage 4: Docker verification (deterministic tool invocation)

Verify the **reference artifact** in Docker:

- compile/run the reference artifact with the generated test suite
- require that the reference passes all tests

If verification fails:

- classify the failure (compile/tests/timeout/unknown)
- retry per slot up to a bounded maximum
- propagate a failure after retries are exhausted

## Stage 5: Guided scaffolding (optional, deterministic)

If slot has pedagogy metadata (Guided Mode):

- derive a learner-facing scaffold from the verified reference artifact
- add TODO markers and (optionally) deterministic hint lines
- optional dynamic guided hints may be injected (feature-flagged), but must not affect tests

This stage runs *after* Docker verification so scaffolding is based on a known-correct artifact.

## Stage 6: Discard reference artifacts (critical)

Codem treats reference artifacts as generation-only:

- they are required for verification
- they must not be persisted

The persisted problem object is a `GeneratedProblem` (draft minus reference artifact).

This is a hard security boundary.

## Outputs and progress reporting

During generation the backend emits structured progress events over SSE (`GET /sessions/:id/generate/stream`).

Events are designed to be safe for user display:

- no prompts
- no raw generations
- no reference artifacts

See `../api/backend.md` and `../debugging.md`.

