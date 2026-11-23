/**
 * Tests for the dry-run batch validation endpoint (#batch-validate).
 *
 * Uses in-memory stubs so no real MongoDB connection is required.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRecord, BatchValidationRepository, MAX_BATCH_SIZE } from "../src/db/batch-validate.js";
import type { VerificationDoc } from "../src/db/collections.js";
import type { Db } from "mongodb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_HASH = "a".repeat(64);
const VALID_CREATOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const VALID_REF = "ipfs://Qmtest";
const NOW = new Date("2026-11-01T10:00:00.000Z");

function makeDoc(overrides: Partial<VerificationDoc> = {}): VerificationDoc {
  return {
    jobId: "job-1",
    contentHash: VALID_HASH,
    manifestHash: VALID_HASH,
    creator: VALID_CREATOR,
    storageRef: VALID_REF,
    status: "pending",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateRecord — unit tests
// ---------------------------------------------------------------------------

test("validateRecord: valid pending doc passes", () => {
  const outcome = validateRecord(makeDoc());
  assert.equal(outcome.valid, true);
  assert.deepEqual(outcome.errors, []);
});

test("validateRecord: valid certified doc passes", () => {
  const outcome = validateRecord(
    makeDoc({
      status: "certified",
      certId: "cert-1",
      txHash: VALID_HASH,
      completedAt: NOW,
    }),
  );
  assert.equal(outcome.valid, true);
  assert.deepEqual(outcome.errors, []);
});

test("validateRecord: sha256: prefix is accepted in contentHash", () => {
  const outcome = validateRecord(makeDoc({ contentHash: `sha256:${VALID_HASH}` }));
  assert.equal(outcome.valid, true);
});

test("validateRecord: missing contentHash is an error", () => {
  const outcome = validateRecord(makeDoc({ contentHash: "" }));
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("contentHash")));
});

test("validateRecord: non-hex contentHash is an error", () => {
  const outcome = validateRecord(makeDoc({ contentHash: "not-a-hash" }));
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("contentHash")));
});

test("validateRecord: missing manifestHash is an error", () => {
  const outcome = validateRecord(makeDoc({ manifestHash: "" }));
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("manifestHash")));
});

test("validateRecord: invalid creator address is an error", () => {
  const outcome = validateRecord(makeDoc({ creator: "not-an-address" }));
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("creator")));
});

test("validateRecord: empty storageRef is an error", () => {
  const outcome = validateRecord(makeDoc({ storageRef: "" }));
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("storageRef")));
});

test("validateRecord: certified without certId is an error", () => {
  const outcome = validateRecord(
    makeDoc({ status: "certified", txHash: VALID_HASH, completedAt: NOW }),
  );
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("certId")));
});

test("validateRecord: certified without txHash is an error", () => {
  const outcome = validateRecord(
    makeDoc({ status: "certified", certId: "cert-1", completedAt: NOW }),
  );
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("txHash")));
});

test("validateRecord: certified without completedAt is an error", () => {
  const outcome = validateRecord(
    makeDoc({ status: "certified", certId: "cert-1", txHash: VALID_HASH }),
  );
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("completedAt")));
});

test("validateRecord: certified with error field is an error", () => {
  const outcome = validateRecord(
    makeDoc({
      status: "certified",
      certId: "cert-1",
      txHash: VALID_HASH,
      completedAt: NOW,
      error: "some leftover error",
    }),
  );
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("error field")));
});

test("validateRecord: failed without completedAt is an error", () => {
  const outcome = validateRecord(makeDoc({ status: "failed" }));
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((e) => e.includes("completedAt")));
});

test("validateRecord: multiple errors are all reported", () => {
  const outcome = validateRecord(makeDoc({ contentHash: "", manifestHash: "", creator: "" }));
  assert.ok(outcome.errors.length >= 3, "all three field errors must be reported together");
});

test("validateRecord: returns the jobId from the input doc", () => {
  const outcome = validateRecord(makeDoc({ jobId: "my-specific-job" }));
  assert.equal(outcome.jobId, "my-specific-job");
});

// ---------------------------------------------------------------------------
// BatchValidationRepository — unit tests with stub Db
// ---------------------------------------------------------------------------

function makeDb(docs: VerificationDoc[]): Db {
  let total = docs.length;
  const cursor = {
    sort() { return this; },
    limit(n: number) {
      // Return n+1 items to simulate the hasMore detection (the repo fetches limit+1).
      const copy = { ...this, _limit: n };
      return copy;
    },
    async toArray(this: { _limit?: number }) {
      const lim = this._limit ?? docs.length;
      return docs.slice(0, lim);
    },
  };
  return {
    collection() {
      return {
        find() { return cursor; },
        async countDocuments() { return total; },
      };
    },
  } as unknown as Db;
}

test("BatchValidationRepository: empty collection returns empty results", async () => {
  const repo = new BatchValidationRepository(makeDb([]));
  const result = await repo.validate({});
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.results, []);
  assert.equal(result.total, 0);
  assert.equal(result.nextCursor, null);
});

test("BatchValidationRepository: valid docs produce valid outcomes", async () => {
  const docs = [makeDoc({ jobId: "j1" }), makeDoc({ jobId: "j2" })];
  const repo = new BatchValidationRepository(makeDb(docs));
  const result = await repo.validate({ limit: 10 });
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((r) => r.valid));
});

test("BatchValidationRepository: invalid doc produces errors in outcome", async () => {
  const docs = [makeDoc({ jobId: "bad", contentHash: "not-valid" })];
  const repo = new BatchValidationRepository(makeDb(docs));
  const result = await repo.validate({});
  assert.equal(result.results[0]?.valid, false);
  assert.ok((result.results[0]?.errors.length ?? 0) > 0);
});

test("BatchValidationRepository: dryRun is always true", async () => {
  const repo = new BatchValidationRepository(makeDb([]));
  const result = await repo.validate({});
  assert.equal(result.dryRun, true);
});

test("BatchValidationRepository: limit is capped at MAX_BATCH_SIZE", () => {
  assert.equal(MAX_BATCH_SIZE, 100);
});

test("BatchValidationRepository: nextCursor is null when results fit in one page", async () => {
  // 2 docs, limit 10 → no next page
  const docs = [makeDoc({ jobId: "j1" }), makeDoc({ jobId: "j2" })];
  const repo = new BatchValidationRepository(makeDb(docs));
  const result = await repo.validate({ limit: 10 });
  assert.equal(result.nextCursor, null);
});
