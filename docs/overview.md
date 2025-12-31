# Overview

Codem Backend provides three capabilities that the frontend (and other clients) depend on:

1. **Session-driven spec building**: an interactive loop that turns user chat into a validated `ActivitySpec`.
2. **Verified generation**: deterministic planning + LLM drafting + contract validation + Docker verification, producing persisted problems.
3. **Sandboxed execution/judging**: endpoints that run untrusted code in Docker with strict constraints.

The backend is also the system of record for:

- Session state, commitments, and conversation history
- Activities and problems
- Submissions and deterministic learner-profile updates

## Key Design Goal: Determinism at the Boundary

Codem is “agentic” because it performs multi-step reasoning and orchestration across user turns and across generation steps.

Codem is “deterministic” because the LLM is not allowed to directly mutate durable state. The backend enforces this separation:

- **LLM behavior**: propose patches and drafts (best-effort, fallible).
- **Deterministic behavior**: validate, apply, gate, retry, verify, and persist.

This separation is what makes the system auditable and safe to operate:

- A malformed or adversarial LLM output cannot bypass contracts.
- A successful generation is backed by Docker verification, not trust.
- UI streams are safe: prompts, raw generations, and reference solutions are not exposed.

## What “Verified” Means in Codem

Codem treats the LLM output as untrusted input. Verification is explicit:

- Generated problem drafts must satisfy strict schemas (e.g., valid test suites).
- A generated **reference artifact** must compile and pass all tests in Docker.
- The backend discards reference artifacts before persistence.

See:

- Contracts: `state-and-models.md`
- Generation pipeline: `pipelines/generation.md`
- Guardrails: `agentic-design/guardrails-and-validation.md`

