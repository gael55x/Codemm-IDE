# Error Handling

Codem’s backend error handling is designed for:

- predictable client behavior (clear HTTP status usage),
- bounded failure recovery (retries/fallbacks in generation),
- safe observability (no leaking prompts/reference artifacts).

## HTTP errors

General conventions:

- `400` for invalid input shape or unsupported options (e.g., invalid language).
- `401` for unauthenticated access where auth is required.
- `403` for authenticated but unauthorized access.
- `404` for missing resources (sessions/activities).
- `409` for state conflicts (invalid transitions or invalid operation in current state).
- `5xx` for internal errors.

The body typically includes:

- `{ "error": "..." }`
- optional `{ "detail": "..." }` (used for server errors)

## Session loop errors

`POST /sessions/:id/messages` can return `accepted: false` for recoverable situations (e.g., a conflict state) while still returning a `nextQuestion` and a `spec` snapshot.

Clients should:

- treat `accepted=false` as “message was not applied”
- still render the next question and allow user correction

## Generation errors

Generation failures are isolated per slot, with bounded retries per slot.

Failure classes include:

- contract failures (invalid draft output)
- Docker verification failures (compile/tests/timeout)
- unknown/internal failures

When generation fails:

- the progress stream emits a terminal failure event
- the session may transition to `FAILED` (with a possible recovery path depending on state machine rules)

Deterministic fallbacks may be applied to improve reliability, but they must remain auditable and must preserve contract validity.

See `agentic-design/failure-modes.md`.

## SSE errors

For SSE endpoints:

- errors are returned as normal JSON for missing resources before the stream is opened
- once the stream is open, the backend should prefer sending a terminal event (or ending the stream) rather than switching to JSON responses

Clients should:

- handle disconnects and reconnects
- tolerate replayed buffered events

