# Codem Backend

## Project Overview

Codem Backend is the system of record for Codem’s agentic workflow: it turns user chat into a validated `ActivitySpec`, generates verified problems via Docker, and exposes execution/judging APIs used by the frontend.

Core safety property: the LLM never mutates persisted state directly. It produces proposals that are validated and applied by deterministic code (schemas, invariants, state transitions, and verification).

## High-Level Architecture

- **HTTP API (Express)**: routes in `src/server.ts` and `src/routes/sessions.ts`
- **SpecBuilder (agent loop)**: per-message processing that proposes and applies spec patches deterministically
- **Deterministic compiler boundary**: schema validation, invariants, JSON Patch application, confirmation gating
- **Planner**: deterministic expansion of `ActivitySpec` into per-problem “slots” (`src/planner`)
- **Generator**: per-slot LLM calls + strict contracts + retries (`src/generation`)
- **Judge**: Docker-sandboxed compile/run/testing (`src/judge`, `src/languages/*`)
- **Persistence (SQLite)**: sessions, activities, submissions, learner profiles (`src/database.ts`)

## Core Responsibilities

- Define and enforce contracts (`ActivitySpec`, `GeneratedProblemDraft`, progress events).
- Orchestrate the session state machine and deterministic confirmation/commitment rules.
- Generate problems and validate reference artifacts in Docker, then discard reference artifacts before persistence.
- Execute and judge untrusted user submissions in Docker (`/run`, `/submit`).
- Provide observability streams that are safe to show to users (no prompts, no reference solutions).

## Getting Oriented

**Repo layout**

- `src/routes/sessions.ts` – sessions API + SSE streams
- `src/services/sessionService.ts` – session orchestration + state transitions
- `src/compiler/*` – draft validation, invariants, JSON Patch application
- `src/agent/*` – deterministic parsing, readiness, commitments, fallbacks
- `src/planner/*` – slot planning from a validated spec
- `src/generation/*` – per-slot generation, Docker validation, scaffolding
- `src/languages/*` – language profiles, rules, adapters
- `src/database.ts` – SQLite schema and DB access layer

**Local development**

Prereqs: Node.js 18+, npm, Docker Desktop (or equivalent).

```bash
cp .env.example .env
./run-codem-backend.sh
```

Health check: `curl -sS http://localhost:${PORT:-4000}/health`

## Documentation Index

- Start here: `docs/index.md`
- Architecture and invariants: `docs/architecture.md`, `docs/agentic-design/principles.md`
- Data flow & state machine: `docs/data-flow.md`, `docs/agentic-design/memory-and-state.md`
- API reference: `docs/api/backend.md`
- Debugging & tracing: `docs/debugging.md`
- Contributing: `docs/contributing.md`

## Contributing

See `docs/contributing.md` for workflow, local validation, and how to extend the system without weakening determinism, contracts, or sandboxing.
