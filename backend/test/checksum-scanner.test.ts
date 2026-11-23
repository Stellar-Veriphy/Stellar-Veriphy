/**
 * Tests for the evidence checksum scanner (#evidence-integrity).
 *
 * Uses in-memory stubs so no real filesystem or MongoDB connection is required.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import type { Db, Collection } from "mongodb";
import type { Logger } from "../src/lib/logger.js";
import type { MediaStorage, StoredObject } from "../src/storage/media.js";
import { EvidenceChecksumScanner } from "../src/maintenance/checksum-scanner.js";
import type { VerificationDoc } from "../src/db/collections.js";

// ---------------------------------------------------------------------------
// Helpers / stubs
// ---------------------------------------------------------------------------

function noop() {}
const log = {
  debug: noop, info: noop, warn: noop, error: noop,
} as unknown as Logger;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Builds a fake in-memory MediaStorage whose objects are keyed by content string. */
function makeStorage(objects: Record<string, string>): MediaStorage & { objects: Record<string, string> } {
  return {
    name: "stub",
    objects,
    async *list(): AsyncIterable<StoredObject> {
      for (const key of Object.keys(objects)) {
        yield { key, sizeBytes: objects[key]!.length, lastModified: new Date() };
      }
    },
    refFor(key: string): string { return `stub://${key}`; },
    keyFromRef(ref: string): string | undefined {
      if (!ref.startsWith("stub://")) return undefined;
      return ref.slice("stub://".length);
    },
    async delete(key: string): Promise<void> { delete objects[key]; },
  };
}

type StubDoc = Pick<VerificationDoc, "jobId" | "contentHash" | "storageRef">;

/** Builds a minimal Db stub whose `verifications` cursor returns the given docs. */
function makeDb(docs: StubDoc[]): Db {
  const cursor = {
    project() { return this; },
    batchSize() { return this; },
    async *[Symbol.asyncIterator]() { yield* docs; },
  };
  const col = {
    find() { return cursor; },
  } as unknown as Collection;
  return {
    collection() { return col; },
  } as unknown as Db;
}

function makeScanner(docs: StubDoc[], storage: MediaStorage): EvidenceChecksumScanner {
  return new EvidenceChecksumScanner(
    makeDb(docs),
    storage,
    undefined, // no webhooks in unit tests
    "test-instance",
    log,
    { batchSize: 10, maxAlertIds: 20 },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("checksum scanner: empty collection returns zero counts", async () => {
  const scanner = makeScanner([], makeStorage({}));
  const result = await scanner.run();
  assert.equal(result.scanned, 0);
  assert.equal(result.altered, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.safeIds, []);
});

test("checksum scanner: matching hash reports no findings", async () => {
  const content = "hello world";
  const hash = sha256(content);
  const storage = makeStorage({ "file1.bin": content });
  const docs: StubDoc[] = [
    { jobId: "job-1", contentHash: hash, storageRef: "stub://file1.bin" },
  ];

  const scanner = makeScanner(docs, storage);
  const result = await scanner.run();

  assert.equal(result.scanned, 1);
  assert.equal(result.altered, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.safeIds, []);
});

test("checksum scanner: sha256: prefix is stripped before comparison", async () => {
  const content = "content with prefix";
  const hash = `sha256:${sha256(content)}`;
  const storage = makeStorage({ "file2.bin": content });
  const docs: StubDoc[] = [
    { jobId: "job-2", contentHash: hash, storageRef: "stub://file2.bin" },
  ];

  const scanner = makeScanner(docs, storage);
  const result = await scanner.run();

  assert.equal(result.scanned, 1);
  assert.equal(result.altered, 0);
  assert.equal(result.missing, 0);
});

test("checksum scanner: altered file is reported with jobId, not file path", async () => {
  const original = "original content";
  const tampered = "tampered content";
  const originalHash = sha256(original);

  // Storage holds the tampered version, DB records the original hash.
  const storage = makeStorage({ "evidence.bin": tampered });
  const docs: StubDoc[] = [
    { jobId: "job-altered", contentHash: originalHash, storageRef: "stub://evidence.bin" },
  ];

  const scanner = makeScanner(docs, storage);
  const result = await scanner.run();

  assert.equal(result.scanned, 1);
  assert.equal(result.altered, 1);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.safeIds, ["job-altered"]);
});

test("checksum scanner: missing file is reported separately from altered", async () => {
  // Storage is empty; DB references a file that no longer exists.
  const storage = makeStorage({});
  const docs: StubDoc[] = [
    { jobId: "job-missing", contentHash: sha256("was here"), storageRef: "stub://gone.bin" },
  ];

  const scanner = makeScanner(docs, storage);
  const result = await scanner.run();

  assert.equal(result.scanned, 1);
  assert.equal(result.altered, 0);
  assert.equal(result.missing, 1);
  assert.deepEqual(result.safeIds, ["job-missing"]);
});

test("checksum scanner: refs belonging to another backend are skipped", async () => {
  // An IPFS or Arweave ref that keyFromRef() cannot resolve must be skipped silently.
  const storage = makeStorage({});
  const docs: StubDoc[] = [
    { jobId: "job-ipfs", contentHash: sha256("ipfs content"), storageRef: "ipfs://Qmtest" },
  ];

  const scanner = makeScanner(docs, storage);
  const result = await scanner.run();

  // The record was scanned (cursor returned it) but no file check was done.
  assert.equal(result.scanned, 1);
  assert.equal(result.altered, 0);
  assert.equal(result.missing, 0);
});

test("checksum scanner: safeIds are capped at maxAlertIds", async () => {
  const content = "x";
  const hash = sha256("different"); // intentionally wrong hash → all report altered
  const objects: Record<string, string> = {};
  const docs: StubDoc[] = [];

  for (let i = 0; i < 30; i++) {
    objects[`file${i}.bin`] = content;
    docs.push({ jobId: `job-${i}`, contentHash: hash, storageRef: `stub://file${i}.bin` });
  }

  const scanner = new EvidenceChecksumScanner(
    makeDb(docs),
    makeStorage(objects),
    undefined,
    "test",
    log,
    { batchSize: 50, maxAlertIds: 20 }, // cap at 20
  );

  const result = await scanner.run();
  assert.equal(result.altered, 30);
  assert.ok(result.safeIds.length <= 20, "safeIds must not exceed maxAlertIds");
});

test("checksum scanner: scan returns durationMs and completedAt", async () => {
  const scanner = makeScanner([], makeStorage({}));
  const before = Date.now();
  const result = await scanner.run();
  const after = Date.now();

  assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0);
  assert.ok(result.completedAt.getTime() >= before);
  assert.ok(result.completedAt.getTime() <= after + 100); // allow minor clock skew
});

test("checksum scanner: repairs are never performed (read-only)", async () => {
  // The storage.delete method must never be called by the scanner.
  let deleteCount = 0;
  const storage = makeStorage({ "file.bin": "wrong content" });
  const originalDelete = storage.delete.bind(storage);
  storage.delete = async (key: string) => {
    deleteCount++;
    return originalDelete(key);
  };

  const docs: StubDoc[] = [
    { jobId: "job-ro", contentHash: sha256("correct content"), storageRef: "stub://file.bin" },
  ];

  const scanner = makeScanner(docs, storage);
  await scanner.run();

  assert.equal(deleteCount, 0, "scanner must never call storage.delete");
});
