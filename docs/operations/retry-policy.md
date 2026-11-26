# Retry policy

> Labels: backend, reliability

This document describes the retry behaviour for provider operations — both
the shared `ExternalApiClient` (HTTP calls to Horizon, Soroban RPC, IPFS, KMS,
the TEE oracle, webhook receivers) and the generic `withRetry` utility used by
internal callers (MongoDB connection, health checks).

## Principles

1. **Retry only applies to eligible failure classes.** Transient failures
   (timeouts, connection errors, 429/5xx HTTP responses) are retried. Permanent
   failures (4xx other than 408/429, invalid responses, aborted requests,
   programming errors) are never retried.

2. **Maximum attempts and delay are bounded.** The per-service `retries`
   setting caps the number of retries after the first attempt (hard ceiling:
   5). The `retryMaxDelayMs` setting caps the backoff for any single retry.
   The `totalTimeoutMs` setting caps the overall budget; no retry starts if it
   would exceed the deadline.

3. **Retries are observable.** Every retry increments `sv_external_api_retries_total`
   (for HTTP calls) or `sv_retry_attempts_total` (for generic retries), logged
   at warn level with the service, reason, attempt number and delay. Retries
   skipped because the deadline would be exceeded increment
   `sv_retry_skipped_total`.

4. **Retries do not duplicate final actions.** Only idempotent HTTP methods
   (GET, HEAD, OPTIONS, PUT, DELETE) are retried by default. POST/PATCH require
   an explicit `idempotent: true` flag (e.g. when carrying an idempotency key).
   The job queue's `beginFinalization()` fence prevents cancellation from
   racing with irreversible provider calls.

## Eligible failure classes

| Failure class | HTTP statuses | Retried? | Reason |
|---|---|---|---|
| Timeout | — | Yes | The server may be slow, not down. |
| Connection | — | Yes | Network blips, DNS hiccups. |
| HTTP 408 | 408 | Yes | Server explicitly says "retry later." |
| HTTP 425 | 425 | Yes | "Too Early" — server not ready. |
| HTTP 429 | 429 | Yes | Rate limited; `Retry-After` is respected. |
| HTTP 500–504 | 500, 502, 503, 504 | Yes | Server-side transient failure. |
| HTTP 4xx (other) | 400, 401, 403, 404, 422 | No | Client error; retrying won't help. |
| Invalid response | — | No | Non-JSON body; provider bug. |
| Aborted | — | No | Caller cancelled the request. |

## Backoff strategy

Exponential backoff with **equal jitter**: half fixed, half random, capped at
`retryMaxDelayMs`. This prevents thundering-herd retries while spreading load.

```
delay = min(maxDelay, baseDelay * 2^(attempt-1))
jittered = delay/2 + random(0, delay/2)
```

The `Retry-After` header (when present) overrides the computed backoff if it
is larger, but is itself capped by `retryMaxDelayMs`.

## Configuration

### External API calls

See [external-api-timeouts.md](external-api-timeouts.md) for the full
configuration reference. Defaults:

| Setting | Default | Cap |
|---|---|---|
| `EXTERNAL_API_RETRIES` | 2 | 5 (hard-coded) |
| `EXTERNAL_API_RETRY_BASE_DELAY_MS` | 250 | — |
| `EXTERNAL_API_RETRY_MAX_DELAY_MS` | 5000 | — |
| `EXTERNAL_API_TOTAL_TIMEOUT_MS` | 30000 | — |

### Generic retry (`withRetry`)

The `withRetry` function accepts a `shouldRetry` predicate that inspects the
error and the attempt number. Only errors matching the predicate are retried.
Aborted errors (caller cancellation) are never retried regardless of the
predicate. The `totalTimeoutMs` option caps the overall budget; no retry
starts if it would exceed the deadline.

### Health checks

Health check retries are configured via `HEALTH_CHECK_RETRIES` (default 2).
Only transient failures (timeout, connection, unhealthy) are retried.
Misconfiguration and invalid responses are not retried — those need a fix.

### MongoDB connection

The MongoDB connection uses 5 retries with 1–15s backoff. Only transient
connection failures (`MongoServerSelectionError`, `MongoNetworkError`,
`MongoTimeoutError`) are retried.

## Metrics

| Metric | Labels | Description |
|---|---|---|
| `sv_external_api_retries_total` | service, reason | Retries scheduled for HTTP calls |
| `sv_retry_attempts_total` | operation, reason | Generic retry attempts |
| `sv_retry_skipped_total` | operation, reason | Retries skipped due to deadline |
| `sv_external_api_timeouts_total` | service, method | Attempts that timed out |
| `sv_external_api_slow_responses_total` | service, method | Successful but slow attempts |
