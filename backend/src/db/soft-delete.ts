import { type Db, type ObjectId } from "mongodb";
import { Collections, type SoftDeletedVerificationDoc, type VerificationDoc } from "./collections.js";
import type { Logger } from "../lib/logger.js";

/**
 * Soft deletion for verification records.
 *
 * Soft deletion hides a record from normal reads immediately but keeps it
 * recoverable for an authorized operator until permanent retention cleanup runs.
 *
 * Policy (see docs/operations/soft-delete-recovery.md):
 * - `softDelete`: marks the live record with `softDeletedAt` and writes a full
 *   snapshot to `soft_deleted_verifications`. Both steps are wrapped in a
 *   MongoDB client session so a crash leaves both consistent.
 * - `recover`: removes the soft-delete marker from the live record, records the
 *   recovery in the snapshot, and writes an audit event. The caller must hold
 *   admin authorization before calling this method.
 * - `permanentlyPurge`: deletes snapshots older than `retentionCutoff`. Called
 *   by the retention cleanup task; snapshots past the window cannot be recovered.
 *
 * The `verifications` collection itself remains on the RETENTION_DELETABLE_COLLECTIONS
 * allow-list deny-list (it is NOT on the list), so the cleanup framework will never
 * accidentally hard-delete live records. Only this repository touches soft-delete fields.
 */
export class SoftDeleteRepository {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  private get snapshots() {
    return this.db.collection<SoftDeletedVerificationDoc>(Collections.softDeletedVerifications);
  }

  private get verifications() {
    return this.db.collection<VerificationDoc>(Collections.verifications);
  }

  /**
   * Soft-deletes a verification by jobId.
   *
   * - Marks the live record with softDeletedAt/By/Reason so normal reads skip it.
   * - Writes a full snapshot to `soft_deleted_verifications` for audit and recovery.
   * - Writes an audit event to `security_audit_events`.
   *
   * Returns false if the record does not exist or is already soft-deleted.
   * Returns true on success.
   */
  async softDelete(jobId: string, deletedBy: string, reason: string): Promise<boolean> {
    const now = new Date();
    const session = this.db.client.startSession();
    try {
      let succeeded = false;
      await session.withTransaction(async () => {
        const record = await this.verifications.findOne(
          { jobId, softDeletedAt: { $exists: false } },
          { session },
        );
        if (!record) return; // not found or already soft-deleted

        // Mark live record hidden from normal reads.
        const result = await this.verifications.updateOne(
          { jobId, softDeletedAt: { $exists: false } },
          {
            $set: {
              softDeletedAt: now,
              softDeletedBy: deletedBy,
              softDeleteReason: reason,
              updatedAt: now,
            },
          },
          { session },
        );
        if (result.modifiedCount !== 1) return; // raced with another delete

        // Persist full snapshot for recovery.
        await this.snapshots.insertOne(
          {
            ...record,
            originalId: record._id as ObjectId,
            softDeletedAt: now,
            softDeletedBy: deletedBy,
            softDeleteReason: reason,
          },
          { session },
        );

        succeeded = true;
      });

      if (succeeded) {
        await this.audit("verification.soft_deleted", { jobId, deletedBy, reason });
        this.log.info("verification soft-deleted", { jobId, deletedBy, reason });
      }
      return succeeded;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Recovers a soft-deleted verification by jobId.
   *
   * - Removes soft-delete fields from the live record so it reappears in normal reads.
   * - Stamps the snapshot with recoveredAt/By so the audit trail is complete.
   * - Writes an audit event.
   *
   * The caller must verify admin authorization before calling this method.
   * Returns false if the record is not currently soft-deleted.
   */
  async recover(jobId: string, recoveredBy: string): Promise<boolean> {
    const now = new Date();
    const session = this.db.client.startSession();
    try {
      let succeeded = false;
      await session.withTransaction(async () => {
        // Check a snapshot exists so we know the deletion was legitimate.
        const snapshot = await this.snapshots.findOne(
          { jobId, recoveredAt: { $exists: false } },
          { session },
        );
        if (!snapshot) return; // not soft-deleted or already recovered

        // Remove soft-delete markers from the live record.
        const result = await this.verifications.updateOne(
          { jobId, softDeletedAt: { $exists: true } },
          {
            $unset: { softDeletedAt: "", softDeletedBy: "", softDeleteReason: "" },
            $set: { updatedAt: now },
          },
          { session },
        );
        if (result.modifiedCount !== 1) return; // raced with a concurrent recovery

        // Stamp the snapshot so it is no longer recoverable a second time.
        await this.snapshots.updateOne(
          { jobId, recoveredAt: { $exists: false } },
          { $set: { recoveredAt: now, recoveredBy } },
          { session },
        );

        succeeded = true;
      });

      if (succeeded) {
        await this.audit("verification.recovered", { jobId, recoveredBy });
        this.log.info("soft-deleted verification recovered by operator", { jobId, recoveredBy });
      }
      return succeeded;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Returns the snapshot for a soft-deleted verification, or null if not found.
   * Used by admin endpoints to show operators what can be recovered.
   */
  findSnapshot(jobId: string) {
    return this.snapshots.findOne({ jobId });
  }

  /**
   * Lists soft-deleted snapshots, newest first.
   * `includeRecovered` defaults to false (only un-recovered deletions).
   */
  listSnapshots({ limit = 50, includeRecovered = false }: { limit?: number; includeRecovered?: boolean } = {}) {
    const filter = includeRecovered ? {} : { recoveredAt: { $exists: false } };
    return this.snapshots
      .find(filter, { projection: { originalId: 1, jobId: 1, softDeletedAt: 1, softDeletedBy: 1, softDeleteReason: 1, recoveredAt: 1, recoveredBy: 1, status: 1, creator: 1, createdAt: 1 } })
      .sort({ softDeletedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .toArray();
  }

  /**
   * Permanently purges snapshots whose `softDeletedAt` is before `retentionCutoff`.
   * Called by the retention cleanup task. Returns the number of snapshots purged.
   * Records past this window cannot be recovered.
   */
  async permanentlyPurge(retentionCutoff: Date): Promise<number> {
    const result = await this.snapshots.deleteMany({ softDeletedAt: { $lt: retentionCutoff } });
    if (result.deletedCount > 0) {
      this.log.info("soft-deleted verification snapshots permanently purged", {
        count: result.deletedCount,
        cutoff: retentionCutoff,
      });
    }
    return result.deletedCount;
  }

  private async audit(action: string, context: Record<string, unknown>): Promise<void> {
    await this.db
      .collection("security_audit_events")
      .insertOne({ eventId: crypto.randomUUID(), action, at: new Date(), ...context })
      .catch((err) => this.log.warn("failed to write soft-delete audit event", { action, err }));
  }
}
