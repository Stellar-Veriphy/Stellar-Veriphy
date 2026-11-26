/**
 * Dry-run batch record validation (#batch-validate).
 *
 * Validates a batch of verification records without touching them in the
 * database.  Returns per-record outcomes (valid / error list) and supports
 * keyset pagination for large batches.
 *
 * ## No mutations contract
 *
 * This module only reads from the database and runs in-memory checks.
 * No document is ever written, updated, or deleted by any code path here.
 * All validation functions are pure with respect to storage.
 *
 * ## Pagination
 *
 * Clients submit a `limit` (≤ MAX_BATCH_SIZE) and an optional `cursor`
 * (the `createdAt` ISO-8601 timestamp of the last item from the previous
 * page).  The response includes `nextCursor` when more records follow.
 *
 * Runbook: docs/operations/batch-validate.md
 */

import type { Db, Filter } from "mongodb";
import { Collections, type VerificationDoc } from "./collections.js";

export const MAX_BATCH_SIZE = 100;

export interface BatchValidateInput {
  /**
   * Specific job IDs to validate.  When provided, `cursor` and `limit` apply
   * to this list; when omitted, the full `certified` collection is paginated.
   */
  jobIds?: string[];
  /** Keyset cursor — `createdAt` ISO-8601 of the last item from the previous page. */
  cursor?: string;
  /** Max records to validate per request (1–MAX_BATCH_SIZE, default: 20). */
  limit?: number;
}

export interface RecordValidationOutcome {
  jobId: string;
  valid: boolean;
  /** Non-empty only when `valid` is false. */
  errors: string[];
}

export interface BatchValidateResult {
  dryRun: true;
  results: RecordValidationOutcome[];
  /** Total records matched by the query before pagination. */
  total: number;
  /**
   * Cursor for the next page — `createdAt.toISOString()` of the last item,
   * or `null` when this is the last page.
   */
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

/**
 * Validates a single VerificationDoc in memory.
 *
 * Rules:
 * - `contentHash` must be a 64-char hex string (SHA-256), optionally
 *   prefixed with `sha256:`.
 * - `manifestHash` must be a 64-char hex string.
 * - `creator` must be a Stellar public key (G... 56 characters).
 * - `storageRef` must be non-empty.
 * - `certId` is required when `status` is `"certified"`.
 * - `txHash` is required when `status` is `"certified"`.
 * - `completedAt` is required when `status` is `"certified"` or `"failed"`.
 * - `error` or `errorCode` must be absent when `status` is `"certified"`.
 */
export function validateRecord(doc: VerificationDoc): RecordValidationOutcome {
  const errors: string[] = [];

  // contentHash
  const rawHash = doc.contentHash?.replace(/^sha256:/i, "");
  if (!rawHash || !/^[0-9a-f]{64}$/i.test(rawHash)) {
    errors.push("contentHash must be a valid SHA-256 hex digest");
  }

  // manifestHash
  if (!doc.manifestHash || !/^[0-9a-f]{64}$/i.test(doc.manifestHash)) {
    errors.push("manifestHash must be a valid SHA-256 hex digest");
  }

  // creator
  if (!doc.creator || !/^G[A-Z2-7]{55}$/.test(doc.creator)) {
    errors.push("creator must be a valid Stellar public key (G... 56 chars)");
  }

  // storageRef
  if (!doc.storageRef || doc.storageRef.trim().length === 0) {
    errors.push("storageRef must be non-empty");
  }

  // certified-specific checks
  if (doc.status === "certified") {
    if (!doc.certId) errors.push("certId is required for certified records");
    if (!doc.txHash) errors.push("txHash is required for certified records");
    if (!doc.completedAt) errors.push("completedAt is required for certified records");
    if (doc.error) errors.push("error field must not be set on certified records");
    if (doc.errorCode) errors.push("errorCode field must not be set on certified records");
  }

  // failed-specific checks
  if (doc.status === "failed" && !doc.completedAt) {
    errors.push("completedAt is required for failed records");
  }

  return { jobId: doc.jobId, valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Repository method
// ---------------------------------------------------------------------------

export class BatchValidationRepository {
  constructor(private readonly db: Db) {}

  private get col() {
    return this.db.collection<VerificationDoc>(Collections.verifications);
  }

  /**
   * Validates a batch of records without writing anything.
   *
   * When `input.jobIds` is provided the query is restricted to those IDs;
   * otherwise all records are iterated in `createdAt` descending order.
   */
  async validate(input: BatchValidateInput): Promise<BatchValidateResult> {
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), MAX_BATCH_SIZE);
    const before = input.cursor ? new Date(input.cursor) : undefined;

    const filter: Filter<VerificationDoc> = {};
    if (input.jobIds && input.jobIds.length > 0) {
      filter.jobId = { $in: input.jobIds.slice(0, MAX_BATCH_SIZE) };
    }
    if (before && !Number.isNaN(before.getTime())) {
      filter.createdAt = { $lt: before };
    }

    // Count without pagination so callers know the total matching set.
    const total = await this.col.countDocuments(filter);

    // Fetch the page — one extra record to detect whether a next page exists.
    const docs = await this.col
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;

    const results = page.map(validateRecord);

    const last = page.at(-1);
    const nextCursor = hasMore && last ? last.createdAt.toISOString() : null;

    return { dryRun: true, results, total, nextCursor };
  }
}
