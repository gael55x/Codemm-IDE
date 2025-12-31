# Backend API Reference

This is a developer-facing reference for the HTTP surface implemented by the backend. It documents what exists in code; it does not propose new endpoints.

Base URL (default): `http://localhost:4000`

## Conventions

- JSON requests use `Content-Type: application/json`.
- Auth uses `Authorization: Bearer <token>`.
- SSE endpoints use `text/event-stream`.
- Error responses use `{ "error": "..." }` and may include `detail` for server errors.

## Health

### `GET /health`

Response:

```json
{ "status": "ok" }
```

## Sessions (SpecBuilder)

### `POST /sessions`

Creates a new session.

- Auth: optional (anonymous sessions can later be attached to a user)
- Body (optional):
  - `learning_mode`: `"practice"` | `"guided"`

Response (high-level):

- `sessionId`
- `state`
- `learning_mode`
- `nextQuestion`
- `questionKey`
- `done`

### `GET /sessions`

Lists sessions for the authenticated user.

- Auth: required
- Query:
  - `limit` (optional, default 20)

Response:

- `sessions`: list of summaries (shape defined by DB layer)

### `POST /sessions/:id/messages`

Processes one user message for the session.

- Auth: optional (if provided, anonymous sessions are attached to the user)
- Body:
  - `message` (string, required)

Response:

- `accepted` (boolean)
- `state`
- `nextQuestion` (assistant text for the next turn)
- `questionKey` (server-selected key describing what the UI should ask/confirm next)
- `spec` (current spec draft snapshot)
- `done` (boolean, true when ready to generate)
- optional additive fields:
  - `assistant_summary`
  - `assumptions`
  - `next_action`

### `GET /sessions/:id`

Returns a debug snapshot of the session.

- Auth: not required (current implementation)

Response includes:

- session metadata (`state`, `learning_mode`)
- `spec`
- `messages`
- `collector`, `confidence`, `commitments`, `generationOutcomes`, `intentTrace`

### `POST /sessions/:id/generate`

Generates and persists an activity from the session.

- Auth: required

Response:

- `activityId`
- `problemCount`

### `GET /sessions/:id/generate/stream`

Server-sent events stream of generation progress.

Properties:

- payload is designed to be safe to display (no prompts, no raw generations, no reference artifacts)
- on connect, buffered events may be replayed
- stream ends after completion or failure events

Event payload shapes are defined by the `GenerationProgressEvent` contract.

### `GET /sessions/:id/trace`

Sanitized trace stream (SSE).

- Feature-flagged; returns 404 if disabled
- Intended for debugging without leaking prompts or reference solutions

## Execution (Docker)

### `POST /run`

Execution-only endpoint.

- Auth: not required
- Body:
  - `language`: `"java" | "python" | "cpp" | "sql"`
  - either `code` (string) or `files` (object map of filename → content)
  - optional `stdin`
  - optional `mainClass` (Java, file mode)

Response:

- `stdout`
- `stderr`

### `POST /submit`

Graded endpoint.

- Auth: optional
- Body:
  - `language`
  - `testSuite` (string, required)
  - either `code` or `files`
  - optional `activityId` and `problemId` (for persistence + learner profile updates)

Response:

- judge result (pass/fail, tests, output, timing) as returned by the language adapter

## Auth

### `POST /auth/register`

Body:

```json
{ "username": "...", "email": "...", "password": "...", "displayName": "..." }
```

Response:

- `token`
- `user`

### `POST /auth/login`

Body:

```json
{ "username": "...", "password": "..." }
```

Note: `username` currently accepts either username or email.

### `GET /auth/me`

- Auth: required

Returns the current user profile basics.

## Profile

### `GET /profile`

- Auth: required

Returns:

- user info
- stats summary
- activities (owned by user)
- recent submissions

### `GET /profile/llm`

- Auth: required

Returns whether per-user LLM key config is set.

### `PUT /profile/llm`

- Auth: required

Body:

```json
{ "provider": "openai" | "anthropic" | "gemini", "apiKey": "..." }
```

Notes:

- Requires server configuration for encrypted storage.

### `DELETE /profile/llm`

- Auth: required

Clears stored per-user LLM key config.

## Activities

### `GET /activities`

- Auth: required

Lists activities owned by the authenticated user.

### `GET /activities/:id`

- Auth: optional

Returns:

- activity if owner, or if activity status is `PUBLISHED`

### `PATCH /activities/:id`

- Auth: required
- Owner-only
- Only allowed when activity status is `DRAFT`

### `POST /activities/:id/problems/:problemId/ai-edit`

- Auth: required
- Owner-only
- Only allowed when activity status is `DRAFT`

Edits an existing draft problem via an LLM call.

### `POST /activities/:id/publish`

- Auth: required
- Owner-only

### `POST /activities/:id/community/publish`

- Auth: required
- Owner-only

### `POST /activities/:id/community/unpublish`

- Auth: required
- Owner-only

## Community

### `GET /community/activities`

Public listing of community-published activities.

Query:

- `limit` (1–50)
- `offset` (>= 0)

### `GET /community/activities/:id`

Public fetch of a single community-published activity.

