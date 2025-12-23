# Codem-backend
Codem backend - agentic AI

## Env safety (recommended)

If you ever plan to commit environment values, use dotenvx precommit to avoid leaking secrets:
- https://dotenvx.com/precommit

## Docs

- Agentic platform diagrams: `AGENTIC_PLATFORM.md`

## SpecBuilder (Deterministic Agent Loop)

Codemm follows a strict boundary:

- **LLM proposes**: intent inference + per-slot generation.
- **Compiler decides**: Zod contracts, invariants, JSON Patch application, and deterministic gates.
- **No direct state mutation by LLM**: all persisted state is produced by audited, deterministic code.

### Session API (high level)

- `POST /sessions` → create a session (`DRAFT`)
- `POST /sessions/:id/messages` → agent loop step
  - Response includes:
    - `nextQuestion`: assistant text
    - `questionKey`: stable deterministic key (e.g. `goal:content`, `confirm:topic_tags`, `invalid:difficulty_plan`)
    - `done`: `true` when spec is ready for generation
- `POST /sessions/:id/generate` (auth) → generate activity with Docker-validated reference artifacts (discarded)
- `GET /sessions/:id` → debug snapshot (includes `commitments` and `generationOutcomes`)

### Runtime + grading APIs

- `POST /run` → sandboxed execution (code-only or multi-file) for supported languages.
- `POST /submit` → graded execution (requires `testSuite`) using the language’s judge adapter.
- `GET /activities/:id` (auth) → returns the persisted activity with `problems[]` (each problem includes `language`).

### C++ test runner note

C++ grading uses a custom `test.cpp` runner inside Docker. The generator enforces a variadic macro harness:
- `#define RUN_TEST(name, ...) ... __VA_ARGS__ ...`

This avoids C preprocessor “macro passed N arguments” errors caused by commas inside test blocks.

### Persisted agent memory (auditable)

- `commitments_json`: accepted field/value decisions, with explicit/implicit source + locking.
- `generation_outcomes_json`: per-slot generation results (success/retries/fallback) used for feedback and traceability.
