# Grading Pipeline

This document describes how Codem judges untrusted code.

The backend exposes two related endpoints:

- `POST /run`: execution-only (no tests)
- `POST /submit`: graded execution (requires a test suite)

Both execute untrusted code in Docker via language-specific adapters.

## Common guardrails

Before invoking Docker, the backend enforces:

- request shape and required fields
- supported language constraints (execution vs judging support may differ)
- size limits (total code + tests)
- filename patterns and file count caps

These guardrails ensure that the Docker sandbox receives only valid, bounded input.

## `/run`

Purpose:

- give a fast “run my code” loop during solving

Inputs:

- `language`
- either:
  - `code` (single-file mode), or
  - `files` (multi-file mode), plus optional runtime metadata (e.g. `mainClass` for Java)
- optional `stdin`

Output:

- `{ stdout, stderr }`

No persistence occurs.

## `/submit`

Purpose:

- evaluate code against a provided `testSuite`
- optionally persist the submission if authenticated and linked to an owned problem

Inputs:

- `language`
- `testSuite` (required)
- either:
  - `code`, or
  - `files` (language-specific constraints apply)
- optional `activityId` + `problemId` (used for persistence and learner-profile updates)

Output:

- judge result (pass/fail + test outcomes + output + timing)

Persistence behavior:

- If the request is authenticated and references a valid owned `activityId`/`problemId`, the backend records a submission and may update the learner profile deterministically.

See `feedback.md`.

## Language adapters and rules

Language-specific behavior is encapsulated under:

- `src/languages/*` for rules (e.g., test suite validity constraints)
- `src/judge/*` for Docker integration

When extending languages, preserve the invariant:

- client-visible contracts do not become weaker as languages are added.

