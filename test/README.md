# Tests

Codemm backend uses Node's built-in test runner (`node:test`) with CommonJS test files and `ts-node/register` for importing TypeScript sources.

## Structure

- `test/unit/<component>/`: pure/unit tests (no Docker required), grouped to mirror `src/`.
- `test/integration/<component>/`: tests that touch the DB or multiple modules together, also grouped by area (e.g. `database/`, `routes/`).
- `test/helpers/`: shared test setup helpers.

## Commands

- `npm test`: run all tests.
- `npm run test:unit`: run unit tests only.
- `npm run test:integration`: run integration tests only.
- `node scripts/runTests.js unit generation`: run tests for one component folder.

## Conventions

- Prefer deterministic tests (no network, no real LLM calls, no Docker).
- When you need the DB, require `test/helpers/setupDb` before importing `src/database` (each test should do this itself so it runs per test file/worker).
