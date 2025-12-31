# Contributing

This guide is for contributors working on Codem Backend. The goal is to keep changes safe, deterministic at the boundaries, and easy to review.

## Documentation-first changes

If you are changing behavior related to:

- contracts and schemas
- state transitions
- generation and verification gates
- trace/progress semantics

update the relevant docs under `docs/` in the same PR.

## Local setup

Prereqs:

- Node.js 18+
- npm
- Docker Desktop (or equivalent)

Run:

```bash
cp .env.example .env
./run-codem-backend.sh
```

## What to read before changing core logic

- System invariants: `agentic-design/principles.md`
- Session loop semantics: `data-flow.md`
- Contracts overview: `state-and-models.md`
- Failure modes: `agentic-design/failure-modes.md`

## Change discipline

### Do not weaken invariants casually

Examples of high-risk changes:

- allowing the LLM to write durable state without deterministic validation
- persisting reference artifacts
- streaming prompts or raw generations to clients
- loosening test suite validation without a replacement gate

If a change is necessary, record the rationale in `design-decisions.md`.

### Keep APIs stable

When changing API response shapes:

- prefer additive changes
- maintain backward-compatible progress events where possible
- document behavior changes in `docs/api/backend.md`

### Keep planning deterministic

Planner behavior should remain deterministic:

- the same `ActivitySpec` should produce the same slot plan
- topic distribution should be predictable

If you need randomness, it must be deterministic (seeded) and documented.

## Tests

Run what is appropriate for your change:

- unit tests: `npm run test:unit`
- integration tests: `npm run test:integration`
- full suite: `npm test`

If you change generation or judging, also consider the smoke generation tests (if configured in this repo).

