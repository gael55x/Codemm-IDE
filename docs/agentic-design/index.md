# Agentic Design

This section explains the backend’s agentic behavior in terms of **system invariants** and **deterministic orchestration**, not prompts.

Codem is “agentic” because it:

- Maintains state across turns (session drafts, commitments, collector buffers).
- Plans and executes multi-step workflows (spec building → planning → generation → verification → persistence).
- Uses tools (LLM calls, Docker judge, DB, SSE) under strict contracts.

It is “deterministic” because:

- All durable state transitions and validations are implemented in audited code.
- The LLM’s output is treated as untrusted input.

## Documents

- Principles and invariants: `principles.md`
- Agent lifecycle (session loop): `agents.md`
- Planning vs execution boundaries: `planners.md`
- Tool invocation rules and contracts: `tools-and-actions.md`
- Memory and state models: `memory-and-state.md`
- Guardrails and validation: `guardrails-and-validation.md`
- Failure modes and mitigations: `failure-modes.md`

