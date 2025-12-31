# Codemm Backend

Codemm is an open-source AI agent that turns a short chat into a fully-verified programming activity (problems + tests), and provides Docker-sandboxed `run`/`submit` endpoints for execution and grading.

[Project / official docs live in the frontend repo README.](https://github.com/gael55x/Codem-frontend)

[Docs](documentation/README.md) · [API](documentation/api.md) · [Architecture](documentation/architecture.md)

## Features

- **SpecBuilder sessions API** (`/sessions`): deterministic agent loop that turns chat into an `ActivitySpec`
- **Generation pipeline** (`/sessions/:id/generate`): per-slot LLM drafts → contract validation → Docker verification → persist (reference artifacts discarded)
- **Execution / judge**: `/run` (code-only) and `/submit` (graded with tests) run inside language-specific Docker judge images
- **Observability**: progress SSE + optional sanitized trace SSE (no prompts/raw generations/reference artifacts)
- **SQLite persistence**: sessions, activities, submissions, learner profile

## Design (agentic, but deterministic)

Codemm follows a strict boundary:

- **LLM proposes**: intent inference + per-slot drafts
- **Compiler decides**: Zod contracts, invariants, JSON Patch application, readiness gates, commitment locking, and next-question selection
- **No direct state mutation by the LLM**: persisted state is produced by audited deterministic code paths

More detail: `documentation/architecture.md`

## Learning modes

Codemm exposes a user-facing **Learning Mode** (pedagogy), without changing verification:

- `practice`: generate problems directly from an `ActivitySpec`
- `guided`: scaffolded sequences where student-facing starter code is deterministically derived from a fully-correct reference artifact (tests unchanged; reference artifacts discarded before persistence)

Optional “guided hints” (best-effort) can be disabled with `CODEMM_DYNAMIC_GUIDED_HINTS=0`.

## Getting started (local dev)

Prereqs: Node.js 18+, npm, Docker Desktop (or a running Docker daemon).

1) Configure env:

- `cp .env.example .env`
- Set `JWT_SECRET` and one LLM API key (`CODEX_API_KEY`/`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`/`GOOGLE_API_KEY`)

2) Run (recommended one-command runner; builds judge images if needed):

- `./run-codem-backend.sh`

Then verify:

- Health check: `curl -sS http://localhost:4000/health`

### Manual run

- `npm install`
- `npm run dev`

Production build:

- `npm run build && npm start`

### Runner toggles

- `BACKEND_MODE=prod ./run-codem-backend.sh`
- `REBUILD_JUDGE=1 ./run-codem-backend.sh`

## Configuration

All variables are read from `.env` (see `.env.example`).

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `4000` |
| `JWT_SECRET` | JWT signing secret | (required) |
| `CODEX_PROVIDER` | LLM provider (`openai`/`anthropic`/`gemini`/`auto`) | `auto` |
| `CODEX_API_KEY` | OpenAI-compatible API key (preferred name) | (one required) |
| `OPENAI_API_KEY` | OpenAI API key (alias) | (optional) |
| `ANTHROPIC_API_KEY` | Anthropic API key | (optional) |
| `GEMINI_API_KEY` | Gemini API key | (optional) |
| `GOOGLE_API_KEY` | Gemini API key (alias) | (optional) |
| `CODEX_MODEL` | Override model name | (optional) |
| `CODEX_BASE_URL` | Override API base URL | (optional) |
| `ANTHROPIC_MODEL` | Override Anthropic model | (optional) |
| `ANTHROPIC_BASE_URL` | Override Anthropic API base URL | (optional) |
| `GEMINI_MODEL` | Override Gemini model | (optional) |
| `GEMINI_BASE_URL` | Override Gemini API base URL | (optional) |
| `CODEMM_USER_KEY_ENCRYPTION_KEY` | 32-byte base64 (or 64 hex) key used to encrypt per-user LLM API keys at rest | (required for per-user keys) |
| `CODEMM_DB_PATH` | SQLite DB file path (or `:memory:`) | `data/codem.db` |
| `JUDGE_TIMEOUT_MS` | Judge timeout cap (ms) | `15000` |
| `CODEMM_RUN_TIMEOUT_MS` | `/run` timeout (ms, cap 30000) | (optional) |
| `CODEMM_TRACE` | Enable sanitized SSE trace | `0` |
| `CODEMM_TRACE_TEST_SUITES` | Include debug test snippets in trace | `0` |
| `CODEMM_DYNAMIC_GUIDED_HINTS` | Enable/disable guided hint injection | `1` |

## API (high level)

Base URL: `http://localhost:${PORT:-4000}`

- Sessions (SpecBuilder): `POST /sessions`, `POST /sessions/:id/messages`, `POST /sessions/:id/generate`, `GET /sessions/:id/generate/stream`
- Execution / judge: `POST /run`, `POST /submit`
- Auth / profile: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `GET /profile`

Full details + curl examples: `documentation/api.md`

## Docker judge images

The runner builds these images automatically (from the repo root):

- `codem-java-judge` (`Dockerfile.java-judge`)
- `codem-python-judge` (`Dockerfile.python-judge`)
- `codem-cpp-judge` (`Dockerfile.cpp-judge`)
- `codem-sql-judge` (`Dockerfile.sql-judge`)

## Tests

- `npm test`
- `npm run test:unit`
- `npm run test:integration`
- `npm run smoke:generate`

## Security notes

- `/run` and `/submit` execute untrusted code; keep Docker running with sane defaults and do not expose these endpoints publicly without additional hardening.
- Trace/progress streams intentionally omit prompts, raw generations, and reference artifacts.

## Contributing

- Issues and PRs welcome. If you’re adding new languages/contracts, start with `documentation/architecture.md` so changes stay deterministic.

## License

Package metadata currently declares `ISC` (see `package.json`). If you intend to distribute this as “open source”, add a top-level `LICENSE` file to make terms explicit.
