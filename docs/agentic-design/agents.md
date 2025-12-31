# Agents

In Codem Backend, “agent” refers to the orchestration loop that evolves a session across turns. The loop is implemented as deterministic logic that may invoke the LLM as a proposal engine.

This doc describes the lifecycle and orchestration at a conceptual level.

## Agent lifecycle (session loop)

The core loop is driven by user turns:

1. **Collect**: accept a user message for a session.
2. **Normalize** (deterministic):
   - enforce fixed fields (version/test count/default constraints)
   - parse shorthands that should not depend on LLM phrasing (e.g., difficulty shorthand)
3. **Propose** (LLM):
   - interpret user intent
   - propose a partial spec patch
   - propose a user-visible assistant response
4. **Validate & apply** (deterministic):
   - apply JSON Patch to a spec draft
   - validate draft schema (partial is allowed; invalid fields are rejected)
5. **Gate** (deterministic):
   - if changes touch “hard fields”, require explicit confirmation
6. **Commit** (deterministic):
   - persist commitments to stabilize decisions across turns
7. **Ask next question** (deterministic):
   - compute the next missing fields / inconsistency repairs
8. **Persist**:
   - save updated session state + messages + collector buffer

When the spec is complete and supported, the session reaches `READY`.

## Separation of concerns

Codem keeps these concerns distinct:

- **Dialogue / proposal**: “What does the user want?” (LLM can help)
- **Constraints / contracts**: “What is allowed?” (deterministic)
- **State evolution**: “What is now true?” (deterministic)
- **Orchestration**: “What happens next?” (deterministic, based on gaps)

This separation is the primary mechanism that prevents prompt drift from becoming state drift.

## Deterministic loop prevention

Codem uses multiple mechanisms to prevent “agent churn”:

- **Commitments**: once a user decision is committed, it is treated as stable.
- **Confirmation gates**: hard-field changes require explicit user confirmation.
- **Schema-based gap analysis**: next-question selection is driven by missing/invalid fields, not by open-ended prompting.

See:

- `guardrails-and-validation.md`
- `memory-and-state.md`
- `failure-modes.md`

