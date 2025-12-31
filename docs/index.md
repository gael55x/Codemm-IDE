# Codem Backend Documentation

This documentation is written for contributors and power users who need to understand (or modify) the backend’s behavior without reverse‑engineering prompts.

Codem is an **agentic** system, but the backend is intentionally **deterministic at the boundaries**: the LLM proposes, deterministic code validates and decides what becomes durable state.

## Start Here

- Overview: `overview.md`
- Architecture: `architecture.md`
- End-to-end data flow: `data-flow.md`
- Contracts and persistence: `state-and-models.md`
- API reference: `api/index.md`
- Debugging: `debugging.md`
- Contributing: `contributing.md`

## Deep Dives

- Agentic design (invariants, orchestration, memory): `agentic-design/index.md`
- Core concepts (difficulty planning, evaluation, feedback): `core-concepts/index.md`
- Pipelines (generation, grading, feedback loops): `pipelines/index.md`

