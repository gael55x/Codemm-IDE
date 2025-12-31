# Planners

This document describes **planning vs execution** in Codem Backend.

Codem uses “planner” in a narrow sense:

- **Planner**: deterministic function(s) that convert a validated spec into an execution plan.
- **Executor**: the system that performs the plan (LLM calls, Docker validation, persistence).

## Planner: `ActivitySpec` → `ProblemPlan`

The planner derives a list of slots (a `ProblemPlan`) from the validated `ActivitySpec`.

Properties:

- Deterministic: same input spec yields the same slots.
- Contract-driven: the plan structure is validated (and should stay stable over time).
- Safety-neutral: the planner does not relax contracts; it only schedules work.

Typical slot fields:

- `difficulty` (from `difficulty_plan`)
- `topics` (distributed across slots)
- `language`, `constraints`, `test_case_count`, `problem_style`
- optional `pedagogy` metadata (Guided Mode), which is additive and must not affect verification semantics

See `core-concepts/difficulty-planning.md` for difficulty constraints and shorthand parsing.

## Executor: `ProblemPlan` → persisted problems

The executor consumes the plan:

- invokes the LLM to draft a problem for each slot
- validates the draft against the problem contract
- verifies the reference artifact in Docker
- discards the reference artifact and persists only the learner-facing fields

Execution is intentionally isolated per slot:

- retries are per-slot
- a slot failure does not corrupt other slots
- deterministic fallbacks can be applied to improve reliability

See `pipelines/generation.md` and `agentic-design/failure-modes.md`.

## Why the split exists

This split exists for two reasons:

1) **Auditability**: you can reason about the shape of work without looking at LLM outputs.  
2) **Stability**: small changes to generation logic should not require rethinking plan semantics.

