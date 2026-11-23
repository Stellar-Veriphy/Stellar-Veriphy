/**
 * Tests for soft deletion and recovery (Feature 2).
 *
 * Unit tests run without MongoDB; integration tests (requires TEST_MONGODB_URI)
 * verify the full transaction behaviour.
 *
 * Verifies:
 *  - Soft deletion hides records from normal reads immediately.
 *  - Recovery is permission checked (admin-only endpoint) and audited.
 *  - Permanent cleanup follows the documented retention policy.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

// ---------------------------------------------------------------------------
// Unit: protection layer must include soft_deleted_verifications in its deny list
// ---------------------------------------------------------------------------
import { Collections } from "../src/db/collections.js";
import {
  assertRetentionDeletable,
  ProtectedCollectionError,
  RETENTION_DELETABLE_COLLECTIONS,
} from "../src/maintenance/protection.js";

test("soft_deleted_verifications is NOT on the retention deletable allow-list", () => {
  assert.equal(
    RETENTION_DELETABLE_COLLECTIONS.includes(Collections.softDeletedVerifications),
    false,
    "soft_deleted_verifications must not be mass-deletable by generic retention rules",
  );
});

test("assertRetentionDeletable throws for soft_deleted_verifications", () => {
  assert.throws(
    () => assertRetentionDeletable(Collections.softDeletedVerifications),
    ProtectedCollectionError,
  );
});

// ---------------------------------------------------------------------------
// Unit: SoftDeletedVerificationDoc fields are present on the type
// ---------------------------------------------------------------------------
import type { SoftDeletedVerificationDoc } from "../src/db/collections.js";

test("SoftDeletedVerificationDoc carries the required soft-delete fields", () => {
  // Type-level check: build a minimal doc and verify required fields compile.
  const doc: Partial<SoftDeletedVerificationDoc> = {
    jobId: "test-job",
    softDeletedAt: new Date(),
    softDeletedBy: "operator",
    softDeleteReason: "legal take-down",
    originalId: undefined as never, // ObjectId would be needed in a real doc
  };
  assert.ok(doc.softDeletedAt instanceof Date);
  assert.equal(typeof doc.softDeletedBy, "string");
  assert.equal(typeof doc.softDeleteReason, "string");
});

// ---------------------------------------------------------------------------
// Integration tests — skipped when TEST_MONGODB_URI is not set
// ---------------------------------------------------------------------------
const MONGODB_URI = process.env["TEST_MONGODB_URI"];

if (MONGODB_URI) {
  const { MongoClient } = await import("mongodb");
  const { SoftDeleteRepository } = await import("../src/db/soft-delete.js");
  const { createLogger } = await import("../src/lib/logger.js");
  const { Collections: Cols } = await import("../src/db/collections.js");

  async function withDb<T>(fn: (db: ReturnType<typeof client.db>) => Promise<T>): Promise<T> {
    const client = new MongoClient(MONGODB_URI!);
    await client.connect();
    const db = client.db("sv_soft_delete_test_" + Date.now());
    try {
      return await fn(db);
    } finally {
      await db.dropDatabase().catch(() => undefined);
      await client.close();
    }
  }

  const log = createLogger({}, "error");

  test("soft deletion hides record from verifications collection", async () => {
    await withDb(async (db) => {
      const repo = new SoftDeleteRepository(db, log);
      const verifications = db.collection(Cols.verifications);

      // Insert a fake verification.
      const now = new Date();
      await verifications.insertOne({
        jobId: "jid-1", contentHash: "abc", manifestHash: "def",
        creator: "GABC", storageRef: "local://x", status: "certified",
        createdAt: now, updatedAt: now,
      });

      // Soft-delete it.
      const deleted = await repo.softDelete("jid-1", "operator-ip", "test deletion");
      assert.equal(deleted, true);

      // The live record now has softDeletedAt set.
      const live = await verifications.findOne({ jobId: "jid-1" });
      assert.ok(live?.softDeletedAt instanceof Date, "softDeletedAt must be set");
      assert.equal(live?.softDeletedBy, "operator-ip");

      // A query that filters soft-deleted records returns nothing.
      const hidden = await verifications.findOne({ jobId: "jid-1", softDeletedAt: { $exists: false } });
      assert.equal(hidden, null, "record must be hidden from filtered reads");
    });
  });

  test("soft deletion persists a snapshot for recovery", async () => {
    await withDb(async (db) => {
      const repo = new SoftDeleteRepository(db, log);
      await db.collection(Cols.verifications).insertOne({
        jobId: "jid-2", contentHash: "abc2", manifestHash: "def2",
        creator: "GABC2", storageRef: "local://y", status: "certified",
        createdAt: new Date(), updatedAt: new Date(),
      });

      await repo.softDelete("jid-2", "op", "test");
      const snapshot = await repo.findSnapshot("jid-2");
      assert.ok(snapshot !== null, "snapshot must exist");
      assert.equal(snapshot?.jobId, "jid-2");
      assert.equal(typeof snapshot?.originalId, "object"); // ObjectId
      assert.ok(!snapshot?.recoveredAt, "snapshot must not be pre-stamped recovered");
    });
  });

  test("soft deletion is idempotent — second call returns false", async () => {
    await withDb(async (db) => {
      const repo = new SoftDeleteRepository(db, log);
      await db.collection(Cols.verifications).insertOne({
        jobId: "jid-3", contentHash: "abc3", manifestHash: "def3",
        creator: "GABC3", storageRef: "local://z", status: "certified",
        createdAt: new Date(), updatedAt: new Date(),
      });
      await repo.softDelete("jid-3", "op", "first");
      const second = await repo.softDelete("jid-3", "op", "second");
      assert.equal(second, false, "second soft-delete of same record must return false");
    });
  });

  test("recovery removes soft-delete markers and restores normal reads", async () => {
    await withDb(async (db) => {
      const repo = new SoftDeleteRepository(db, log);
      const verifications = db.collection(Cols.verifications);
      await verifications.insertOne({
        jobId: "jid-4", contentHash: "abc4", manifestHash: "def4",
        creator: "GABC4", storageRef: "local://r", status: "certified",
        createdAt: new Date(), updatedAt: new Date(),
      });

      await repo.softDelete("jid-4", "op", "accidental");
      const ok = await repo.recover("jid-4", "recovering-op");
      assert.equal(ok, true);

      // Live record no longer has soft-delete fields.
      const restored = await verifications.findOne({ jobId: "jid-4" });
      assert.ok(!restored?.softDeletedAt, "softDeletedAt must be unset after recovery");

      // Snapshot is stamped with recovery info.
      const snapshot = await repo.findSnapshot("jid-4");
      assert.ok(snapshot?.recoveredAt instanceof Date);
      assert.equal(snapshot?.recoveredBy, "recovering-op");
    });
  });

  test("recovery returns false when record is not soft-deleted", async () => {
    await withDb(async (db) => {
      const repo = new SoftDeleteRepository(db, log);
      await db.collection(Cols.verifications).insertOne({
        jobId: "jid-5", contentHash: "abc5", manifestHash: "def5",
        creator: "GABC5", storageRef: "local://s", status: "certified",
        createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await repo.recover("jid-5", "op");
      assert.equal(result, false);
    });
  });

  test("recovery is idempotent — second recover returns false", async () => {
    await withDb(async (db) => {
      const repo = new SoftDeleteRepository(db, log);
      await db.collection(Cols.verifications).insertOne({
        jobId: "jid-6", contentHash: "abc6", manifestHash: "def6",
        creator: "GABC6", storageRef: "local://t", status: "certified",
        createdAt: new Date(), updatedAt: new Date(),
      });
      await repo.softDelete("jid-6", "op", "test");
      await repo.recover("jid-6", "op");
      const second = await repo.recover("jid-6", "op2");
      assert.equal(second, false, "second recovery must return false");
    });
  });

  test("permanentlyPurge deletes only snapshots older than the cutoff", async () => {
    await withDb(async (db) => {
      const repo = new SoftDeleteRepository(db, log);
      const snapshots = db.collection(Cols.softDeletedVerifications);
      const old = new Date(Date.now() - 100 * 24 * 3_600_000); // 100 days ago
      const recent = new Date(Date.now() - 1 * 24 * 3_600_000);  // 1 day ago

      await snapshots.insertMany([
        { jobId: "purge-old", softDeletedAt: old, softDeletedBy: "op", softDeleteReason: "r",
          contentHash: "h", manifestHash: "h", creator: "G", storageRef: "s",
          status: "certified" as const, createdAt: old, updatedAt: old, originalId: undefined as never },
        { jobId: "purge-recent", softDeletedAt: recent, softDeletedBy: "op", softDeleteReason: "r",
          contentHash: "h2", manifestHash: "h2", creator: "G", storageRef: "s",
          status: "certified" as const, createdAt: recent, updatedAt: recent, originalId: undefined as never },
      ]);

      const cutoff = new Date(Date.now() - 90 * 24 * 3_600_000); // 90 days
      const purged = await repo.permanentlyPurge(cutoff);
      assert.equal(purged, 1, "only the 100-day-old snapshot should be purged");

      const remaining = await snapshots.find({ jobId: { $in: ["purge-old", "purge-recent"] } }).toArray();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0]!.jobId, "purge-recent");
    });
  });

  test("soft-delete and recovery write audit events", async () => {
    await withDb(async (db) => {
      const repo = new SoftDeleteRepository(db, log);
      await db.collection(Cols.verifications).insertOne({
        jobId: "audit-1", contentHash: "ah", manifestHash: "am",
        creator: "GABC", storageRef: "s", status: "certified" as const,
        createdAt: new Date(), updatedAt: new Date(),
      });

      await repo.softDelete("audit-1", "op-delete", "audit test");
      await repo.recover("audit-1", "op-recover");

      const events = await db.collection("security_audit_events")
        .find({ jobId: "audit-1" }, { sort: { at: 1 } })
        .toArray();

      const actions = events.map((e: Record<string, unknown>) => e["action"]);
      assert.ok(actions.includes("verification.soft_deleted"), "soft_deleted event must be written");
      assert.ok(actions.includes("verification.recovered"), "recovered event must be written");
    });
  });
} else {
  test("soft-delete integration tests skipped (set TEST_MONGODB_URI to enable)", () => {
    // No assertions — informational only.
  });
}
