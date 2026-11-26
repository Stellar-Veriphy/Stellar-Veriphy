/**
 * Tests for the enhanced retry policy (Feature 1).
 *
 * Verifies:
 *  - Retry only applies to eligible failure classes (shouldRetry predicate).
 *  - Maximum attempts are bounded by `retries`.
 *  - Retries are observable via the `onRetry` callback.
 *  - Caller cancellation (signal) is honoured — aborted errors are never retried.
 *  - totalTimeoutMs stops retries that would exceed the overall budget.
 *  - Final actions are not duplicated (the fn is never called after the last failure).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { withRetry, backoffDelay, sleep } from "../src/lib/retry.js";

// ---------------------------------------------------------------------------
// backoffDelay
// ---------------------------------------------------------------------------

test("backoffDelay stays within [baseMs/2, maxMs]", () => {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const delay = backoffDelay(attempt, 100, 1_000);
    assert.ok(delay >= 50, `attempt ${attempt}: delay ${delay} < floor 50ms`);
    assert.ok(delay <= 1_000, `attempt ${attempt}: delay ${delay} > cap 1000ms`);
  }
});

test("backoffDelay respects maxMs ceiling", () => {
  const delay = backoffDelay(99, 100, 200);
  assert.ok(delay <= 200, `delay ${delay} exceeds cap 200ms`);
});

// ---------------------------------------------------------------------------
// withRetry — basic behaviour
// ---------------------------------------------------------------------------

test("withRetry returns immediately on success", async () => {
  let calls = 0;
  const result = await withRetry(async () => { calls++; return "ok"; }, {
    retries: 3, baseDelayMs: 1, maxDelayMs: 1,
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries the configured number of times then throws", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new Error("boom"); }, {
      retries: 2, baseDelayMs: 1, maxDelayMs: 1,
    }),
    /boom/,
  );
  assert.equal(calls, 3); // 1 initial + 2 retries
});

// ---------------------------------------------------------------------------
// shouldRetry — eligible failure classes
// ---------------------------------------------------------------------------

test("withRetry only retries errors matching shouldRetry", async () => {
  let calls = 0;
  const retried: number[] = [];

  class TransientError extends Error { name = "TransientError"; }
  class PermanentError extends Error { name = "PermanentError"; }

  // First attempt: permanent (should NOT retry).
  // Second attempt never reached.
  await assert.rejects(
    withRetry(
      async (attempt) => {
        calls++;
        if (attempt === 1) throw new PermanentError("permanent");
        return "ok";
      },
      {
        retries: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        shouldRetry: (err) => err instanceof TransientError,
        onRetry: (_, attempt) => retried.push(attempt),
      },
    ),
    (err) => err instanceof PermanentError,
  );

  assert.equal(calls, 1);
  assert.equal(retried.length, 0, "permanent error must not trigger a retry");
});

test("withRetry retries when shouldRetry returns true", async () => {
  let calls = 0;
  const retried: number[] = [];

  class TransientError extends Error {}

  const result = await withRetry(
    async (attempt) => {
      calls++;
      if (attempt < 3) throw new TransientError("transient");
      return "recovered";
    },
    {
      retries: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
      shouldRetry: (err) => err instanceof TransientError,
      onRetry: (_, attempt) => retried.push(attempt),
    },
  );

  assert.equal(result, "recovered");
  assert.equal(calls, 3);
  assert.deepEqual(retried, [1, 2]); // onRetry called before each retry
});

test("without shouldRetry all errors are retried (default behaviour preserved)", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new Error("any"); }, {
      retries: 2, baseDelayMs: 1, maxDelayMs: 1,
    }),
    /any/,
  );
  assert.equal(calls, 3);
});

// ---------------------------------------------------------------------------
// signal — caller cancellation
// ---------------------------------------------------------------------------

test("withRetry does not retry when signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    withRetry(async () => { calls++; throw new Error("fail"); }, {
      retries: 5,
      baseDelayMs: 1,
      maxDelayMs: 1,
      signal: controller.signal,
    }),
    /fail/,
  );
  assert.equal(calls, 1, "should not retry with an already-aborted signal");
});

// ---------------------------------------------------------------------------
// totalTimeoutMs — overall budget
// ---------------------------------------------------------------------------

test("withRetry stops retrying when totalTimeoutMs budget is consumed", async () => {
  let calls = 0;
  const start = performance.now();

  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("transient");
      },
      {
        retries: 10,
        baseDelayMs: 50,
        maxDelayMs: 200,
        totalTimeoutMs: 100, // very tight budget
      },
    ),
    /transient/,
  );

  const elapsed = performance.now() - start;
  // Fewer than 10 retries should have fired.
  assert.ok(calls < 11, `expected fewer than 11 calls, got ${calls}`);
  // Should respect the budget — not run for much longer than totalTimeoutMs.
  assert.ok(elapsed < 500, `elapsed ${elapsed.toFixed(0)}ms exceeded reasonable ceiling`);
});

// ---------------------------------------------------------------------------
// onRetry — observability
// ---------------------------------------------------------------------------

test("onRetry receives attempt number and delay for every retry", async () => {
  const events: Array<{ attempt: number; delayMs: number }> = [];

  await assert.rejects(
    withRetry(async () => { throw new Error("x"); }, {
      retries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
      onRetry: (_, attempt, delayMs) => events.push({ attempt, delayMs }),
    }),
  );

  assert.equal(events.length, 3);
  assert.equal(events[0]!.attempt, 1);
  assert.equal(events[1]!.attempt, 2);
  assert.equal(events[2]!.attempt, 3);
  for (const ev of events) {
    assert.ok(ev.delayMs >= 0, `delayMs should be non-negative, got ${ev.delayMs}`);
  }
});

// ---------------------------------------------------------------------------
// Final action not duplicated
// ---------------------------------------------------------------------------

test("fn is never called after the last retry fails", async () => {
  const calls: number[] = [];
  await assert.rejects(
    withRetry(
      async (attempt) => {
        calls.push(attempt);
        throw new Error("fail");
      },
      { retries: 2, baseDelayMs: 1, maxDelayMs: 1 },
    ),
  );
  // fn called exactly retries+1 times — no extra call after final failure.
  assert.deepEqual(calls, [1, 2, 3]);
});
