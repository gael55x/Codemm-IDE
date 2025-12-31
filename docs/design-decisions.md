# Design Decisions

This document records decisions that have high leverage on system behavior. It exists to prevent “accidental refactors” that weaken invariants.

## Deterministic boundary (LLM proposes, compiler decides)

Decision:

- The LLM is a proposal engine; deterministic code decides what is persisted.

Why:

- makes behavior auditable and testable
- reduces blast radius of LLM hallucinations or malformed outputs

Tradeoff:

- requires more deterministic glue code (parsers, schemas, state machines)

## Fixed test count (Codem v1: 8)

Decision:

- `test_case_count` is fixed at 8 in the spec and in problem contracts.

Why:

- simplifies UI expectations and progress reporting
- makes test suite validation stronger and more uniform

Tradeoff:

- less flexible for very small or very large problems

## Language constraints are deterministic defaults

Decision:

- `constraints` is validated to match a per-language default value.

Why:

- keeps generation and judging aligned
- prevents silent drift of execution environment assumptions

Tradeoff:

- requires explicit changes (and docs updates) to evolve language environments

## Reference artifacts are generation-only

Decision:

- reference solutions/workspaces are required for verification but never persisted.

Why:

- prevents leaking “answer keys”
- keeps persisted problems learner-facing
- reduces sensitivity of stored data

Tradeoff:

- debugging generation may require trace streams and local reproduction

## Slot-based planning

Decision:

- generation is driven by deterministic slots derived from `difficulty_plan` and topic distribution.

Why:

- makes generation reproducible for the same spec
- provides a stable surface for progress reporting and retries

Tradeoff:

- requires discipline to keep planner semantics stable as features evolve

## Feedback is deterministic

Decision:

- learner-profile updates are deterministic and bounded; no LLM reflection.

Why:

- keeps feedback explainable and auditable
- avoids introducing a second “agent loop” that can drift

Tradeoff:

- less expressive personalization compared to a model-based learner system

