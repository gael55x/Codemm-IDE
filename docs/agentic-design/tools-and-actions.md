# Tools and Actions

Codem Backend orchestrates multiple “tools”. This document defines what those tools are allowed to do, and how their outputs are constrained.

## Tool: LLM completion

Used in two places:

1. **Session loop** (spec-building): propose a partial patch and assistant text.
2. **Generation**: produce a `GeneratedProblemDraft`.

Contracts:

- LLM output is parsed and then validated against schemas.
- Invalid fields are rejected deterministically.
- The LLM cannot directly mutate the database.

Security model:

- Treat LLM output as untrusted user input.
- Never stream prompts or raw model outputs to clients.

## Tool: Docker judge

Used for:

- verifying generated reference artifacts (generation)
- running user code (`/run`, `/submit`)

Constraints:

- enforce strict resource limits (timeouts, file restrictions, size caps)
- enforce language-specific file layouts and rules
- treat execution output as untrusted text (no HTML rendering assumptions)

Key invariant:

- A generated problem is only considered valid if the reference artifact passes its own test suite in Docker.

## Tool: Database (SQLite)

Used for:

- sessions + message history + collector buffers
- activities and problems
- submissions and learner-profile updates

Constraints:

- Durable state must be derived from deterministic code paths.
- Data models are stored in a normalized format (e.g., JSON blobs for structured fields where appropriate), but all externally visible models must still satisfy their contracts.

## Tool: SSE streams (progress / trace)

Two streams exist:

- **Progress**: `GET /sessions/:id/generate/stream`
- **Trace** (optional): `GET /sessions/:id/trace` (feature-flagged)

Contracts:

- stream payloads must be safe to display to end users
- no prompts, no raw generations, no reference artifacts
- event schemas should evolve additively

Operational behaviors:

- streams should send periodic heartbeats to keep connections alive
- generation streams may replay buffered events for late subscribers

See `debugging.md` for how to use these streams during development.

