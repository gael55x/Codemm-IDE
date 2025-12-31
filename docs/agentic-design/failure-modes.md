# Failure Modes

This document catalogs known failure modes and the mitigation mechanisms Codem uses. It is intentionally framed as: **symptom → cause class → deterministic mitigation**.

## 1) Spec churn across turns

**Symptom**

- The assistant keeps changing previously chosen fields (language, problem count, difficulty mix) without explicit user intent.

**Cause class**

- LLM over-generalization from user phrasing, or inconsistent parsing of multi-intent messages.

**Mitigations**

- Persisted **commitments** lock decisions across turns.
- **Confirmation gating** stages changes to hard fields until explicitly confirmed.
- Next questions are derived from schema gaps, not from open-ended prompting.

See `memory-and-state.md` and `guardrails-and-validation.md`.

## 2) Invalid specs (schema violations)

**Symptom**

- The spec draft contains invalid values (e.g., `difficulty_plan` does not sum to `problem_count`).

**Cause class**

- LLM proposes a patch that violates invariants.

**Mitigations**

- Draft schemas reject invalid fields deterministically.
- Fixed-field enforcement repairs derived defaults.
- Deterministic shorthand parsing replaces ambiguous free-form answers when possible.

See `core-concepts/difficulty-planning.md`.

## 3) Generation contract failures

**Symptom**

- Generated problem drafts fail contract validation (missing fields, invalid test suite structure, invalid workspace shape).

**Cause class**

- LLM output does not match the `GeneratedProblemDraft` schema.

**Mitigations**

- Contract validation is a hard gate; invalid drafts do not proceed to Docker.
- Per-slot retries isolate failures.
- Repair attempts can include previous error information (without persisting reference artifacts).

See `pipelines/generation.md`.

## 4) Docker verification failures

**Symptom**

- Reference artifact fails to compile, fails tests, or times out.

**Cause class**

- Mismatch between problem description/test suite/reference solution.
- Non-deterministic tests or environment assumptions.

**Mitigations**

- Per-slot retries with structured repair context.
- Deterministic generation fallbacks may adjust spec attributes to improve reliability (e.g., prefer return-style checking, reduce hard problems, narrow topics).

See `pipelines/generation.md` and `core-concepts/evaluation.md`.

## 5) UI progress becomes inconsistent

**Symptom**

- Frontend appears “stuck” or shows missing slots.

**Cause class**

- SSE stream opened late, or client lost events due to reconnects.

**Mitigations**

- Generation stream can replay buffered events on connect.
- Heartbeats keep connections alive.
- Progress events are structured and additive.

See `api/backend.md` and `debugging.md`.

## 6) Leakage of sensitive generation content

**Symptom**

- Prompts, raw generations, or reference artifacts appear in trace/progress output or logs.

**Cause class**

- New logging/trace fields added without redaction.

**Mitigations**

- Sanitization functions drop known-sensitive fields for trace streams.
- Design invariant: reference artifacts are never persisted and should never be streamed.

If you add new observability fields, treat them as a security review surface.

