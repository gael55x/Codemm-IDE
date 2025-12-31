# Guardrails and Validation

This document describes the guardrails that keep Codem’s agentic behavior safe and predictable.

The key pattern is repeated throughout the backend:

> Accept untrusted input → validate by contract → apply deterministically → verify with tools → persist.

## 1) Schema validation as a gate

Codem uses strict Zod schemas for:

- spec drafts (partial)
- full specs (complete)
- problem drafts (generation output)
- persisted problems (post-discard)
- progress and trace events (client-visible contracts)

The system treats schemas as executable specifications. If a value fails validation, it does not cross the boundary.

## 2) Fixed-field enforcement

Some fields are intentionally fixed (or derived deterministically) to reduce ambiguity and prevent drift.

Examples:

- spec version is fixed (e.g., `"1.0"`)
- test case count is fixed (Codem v1 expects exactly 8 tests)
- language constraints are set to defaults per language

These rules act as “compiler defaults” that the LLM should not override.

## 3) Difficulty planning constraints

Difficulty planning is a first-class invariant:

- `difficulty_plan` is a list of `{ difficulty, count }`
- counts must sum to `problem_count`
- difficulty entries must be unique

The backend also implements deterministic parsing of common shorthand replies (e.g., “all easy”, “easy:2 medium:1”).

See `core-concepts/difficulty-planning.md`.

## 4) Confirmation gating for hard fields

Some changes are high-impact or churn-prone (e.g., language, problem count, difficulty plan). Codem can require explicit confirmation before applying such changes.

Mechanism:

- a pending patch is stored in the session collector buffer
- the backend returns a `questionKey` that encodes a confirmation request
- a short affirmative reply triggers deterministic application of the pending patch

This protects users from silent plan changes and reduces flip-flopping.

## 5) Docker verification as a safety gate

During generation:

- The backend verifies the generated reference artifact in Docker.
- If the reference artifact fails to compile, fails tests, or times out, the slot fails and is retried deterministically.

This is critical: problems are “verified” by execution, not by language model confidence.

## 6) Sanitized observability

Codem exposes progress and (optionally) trace streams, but applies strict redaction:

- prompts are never streamed
- raw LLM outputs are never streamed
- reference solutions/workspaces are never streamed

If you add new trace fields, ensure they do not leak any of the above categories.

See `debugging.md`.

