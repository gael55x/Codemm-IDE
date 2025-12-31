# Debugging

This document describes the supported mechanisms for understanding backend behavior during development and integration.

## Logs

The backend includes optional dev-only request logging:

- Set `CODEMM_HTTP_LOG=1` to log method, path, status, and latency.
- Logs should not include prompts, generated code, or user submissions.

## Progress stream (SSE)

`GET /sessions/:id/generate/stream` emits structured generation progress events.

Use cases:

- validate that generation is proceeding per-slot
- correlate retries and validation failures
- build robust UI progress reporting

Client expectations:

- events may be replayed on connect
- heartbeats are sent periodically
- stream ends after a completion/failure terminal event

## Trace stream (SSE, optional)

`GET /sessions/:id/trace` emits sanitized trace events when enabled.

Key properties:

- feature-flagged; disabled servers return 404
- sanitized: must not include prompts, raw generations, or reference artifacts

Recommended usage:

- debugging contract failures and state transitions
- diagnosing generation fallbacks and retries

## Common debugging workflows

### Diagnose spec readiness

1. Create a session.
2. Send messages until `done=true` and `questionKey` indicates readiness.
3. Use `GET /sessions/:id` to inspect spec/commitments/collector state.

### Diagnose generation failures

1. Start the progress stream.
2. Trigger generation.
3. Observe per-slot events:
   - contract failures vs Docker verification failures vs timeouts
4. If trace is enabled, correlate with trace events for the same session.

### Diagnose judging behavior

1. Call `/run` with a minimal example for a given language.
2. Call `/submit` with a known test suite and solution.
3. If failures occur, verify that request file layouts match backend constraints.

