/** Resolves after `ms`, or immediately when `signal` aborts. Never rejects. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Exponential backoff with "equal jitter": half fixed, half random, capped at `maxMs`. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

/**
 * Options for {@link withRetry}.
 *
 * Retry only applies to eligible failure classes: the caller provides a
 * `shouldRetry` predicate that inspects the error and the attempt number,
 * and only matching errors are retried. Aborted errors (caller cancellation)
 * are never retried regardless of the predicate.
 *
 * Maximum attempts and delay are bounded:
 * - `retries` caps the number of retries after the first attempt (total = retries + 1).
 * - `maxDelayMs` caps the backoff for any single retry.
 * - `totalTimeoutMs` (optional) caps the overall budget; no retry starts if it would exceed the deadline.
 *
 * Retries are observable via the `onRetry` callback (used for logging and metrics)
 * and do not duplicate final actions because the caller is responsible for
 * idempotency — the predicate should only return true for operations that are
 * safe to repeat.
 *
 * See docs/operations/retry-policy.md for the full policy documentation.
 */
export interface RetryOptions {
  /** Retries after the first attempt (total attempts = retries + 1). */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /**
   * Only errors matching this predicate are retried; defaults to always retry.
   * Use this to restrict retries to eligible failure classes (e.g. transient
   * network errors) and avoid retrying permanent failures (e.g. validation
   * errors, 4xx responses).
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Overall budget for all attempts and backoff; no retry starts once it would be exceeded. */
  totalTimeoutMs?: number;
  /** Caller cancellation; aborted errors are never retried. */
  signal?: AbortSignal;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Bounded retry with exponential backoff and equal jitter.
 *
 * - Only eligible failure classes are retried (via `shouldRetry`).
 * - Maximum attempts are capped by `retries` and the overall deadline `totalTimeoutMs`.
 * - Backoff uses {@link backoffDelay} (exponential with equal jitter, capped at `maxDelayMs`).
 * - Retries are observable via the `onRetry` callback.
 * - Caller cancellation via `signal` is honoured: an aborted signal stops the loop immediately.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const started = performance.now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      // Caller cancellation: never retry.
      if (opts.signal?.aborted) throw err;
      // Exhausted all retries.
      if (attempt > opts.retries) throw err;
      // Only retry eligible failure classes.
      if (opts.shouldRetry && !opts.shouldRetry(err, attempt)) throw err;
      // Respect the overall deadline.
      const elapsed = performance.now() - started;
      if (opts.totalTimeoutMs !== undefined && elapsed >= opts.totalTimeoutMs) throw err;
      const delayMs = backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      // Skip the retry if waiting would exceed the overall budget.
      if (opts.totalTimeoutMs !== undefined && elapsed + delayMs >= opts.totalTimeoutMs) throw err;
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs, opts.signal);
      if (opts.signal?.aborted) throw err;
    }
  }
}
