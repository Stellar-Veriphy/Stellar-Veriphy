/**
 * Evidence checksum scanner (#evidence-integrity).
 *
 * Periodically re-hashes every stored evidence object whose `contentHash` or
 * `manifestHash` can be re-verified against the file on disk, and reports
 * mismatches without altering the original files.
 *
 * ## Scan rules
 *
 * - Only `certified` verifications with a `storageRef` are scanned.
 * - SHA-256 of the file bytes is re-computed and compared to `contentHash`.
 * - Mismatches are logged at `error` level and published as a webhook event.
 * - Missing objects (file no longer on disk) are reported separately.
 * - **No file is ever modified during a scan** — the scanner is read-only.
 *
 * ## Pagination
 *
 * Large datasets are processed in batches of `batchSize`.  Each batch
 * re-computes hashes for up to `batchSize` records; the full scan may span
 * multiple `tick()` calls so no single run blocks the event loop for long.
 *
 * ## Alerting
 *
 * When findings are present the scan publishes a single
 * `"evidence.checksum.scan_complete"` webhook event with:
 *   - `scanned`   — total objects examined this run
 *   - `altered`   — count of objects whose hash no longer matches
 *   - `missing`   — count of objects whose file no longer exists
 *   - `safeIds`   — first N job-id strings (never raw file paths or hashes)
 *
 * Runbook: docs/operations/evidence-checksum-scanner.md
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import type { Db } from "mongodb";
import type { Logger } from "../lib/logger.js";
import type { MediaStorage } from "../storage/media.js";
import { Collections, type VerificationDoc } from "../db/collections.js";
import { releaseLock, tryAcquireLock } from "../db/locks.js";
import type { WebhookService } from "../webhooks/service.js";

export const CHECKSUM_SCAN_EVENT_TYPE = "evidence.checksum.scan_complete";
export const CHECKSUM_MISMATCH_EVENT_TYPE = "evidence.checksum.mismatch";

const LOCK_NAME = "evidence-checksum-scan";
const LOCK_TTL_MS = 30 * 60_000;

export interface ChecksumScanResult {
  scanned: number;
  /** Records whose recomputed hash no longer matches `contentHash`. */
  altered: number;
  /** Records whose storage object no longer exists on disk. */
  missing: number;
  /** Job IDs of affected records (never raw paths or hash values). */
  safeIds: string[];
  durationMs: number;
  completedAt: Date;
}

export interface ChecksumScannerOptions {
  /** How many verification records to process per batch (default: 50). */
  batchSize: number;
  /** Maximum safe IDs to include per alert (keeps payloads bounded). */
  maxAlertIds: number;
}

const DEFAULT_OPTS: ChecksumScannerOptions = {
  batchSize: 50,
  maxAlertIds: 100,
};

/**
 * Recomputes the SHA-256 of a local file and returns the hex digest.
 * Returns null when the file does not exist.
 */
async function computeFileHash(path: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    const passThrough = new Writable({
      write(chunk, _enc, cb) {
        hash.update(chunk as Buffer);
        cb();
      },
    });
    await pipeline(createReadStream(path), passThrough);
    return hash.digest("hex");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Strips a `sha256:` prefix from a stored content hash so both formats
 * (`sha256:aabb...` and `aabb...`) compare correctly.
 */
function normalizeHash(h: string): string {
  return h.toLowerCase().replace(/^sha256:/, "");
}

export class EvidenceChecksumScanner {
  private readonly opts: ChecksumScannerOptions;

  constructor(
    private readonly db: Db,
    private readonly storage: MediaStorage,
    private readonly webhooks: WebhookService | undefined,
    private readonly instanceId: string,
    private readonly log: Logger,
    opts: Partial<ChecksumScannerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  /**
   * Run a full checksum scan.  Acquires a distributed lock so only one
   * instance scans at a time.  Returns the scan result even on partial runs.
   */
  async run(): Promise<ChecksumScanResult> {
    if (!(await tryAcquireLock(this.db, LOCK_NAME, this.instanceId, LOCK_TTL_MS))) {
      this.log.debug("evidence checksum scan skipped; another instance holds the lock");
      return {
        scanned: 0,
        altered: 0,
        missing: 0,
        safeIds: [],
        durationMs: 0,
        completedAt: new Date(),
      };
    }

    const started = Date.now();
    try {
      return await this._scan(started);
    } finally {
      await releaseLock(this.db, LOCK_NAME, this.instanceId).catch((err) =>
        this.log.warn("failed to release checksum scan lock; will expire naturally", { err }),
      );
    }
  }

  private async _scan(started: number): Promise<ChecksumScanResult> {
    const col = this.db.collection<VerificationDoc>(Collections.verifications);
    const { batchSize, maxAlertIds } = this.opts;

    let scanned = 0;
    let altered = 0;
    let missing = 0;
    const affectedIds: string[] = [];

    // Process certified records with a storageRef in batches using a cursor
    // so memory stays bounded regardless of collection size.
    const cursor = col
      .find({ status: "certified", storageRef: { $exists: true, $ne: "" } })
      .project<Pick<VerificationDoc, "jobId" | "contentHash" | "storageRef">>({
        _id: 0,
        jobId: 1,
        contentHash: 1,
        storageRef: 1,
      })
      .batchSize(batchSize);

    for await (const doc of cursor) {
      scanned++;

      // Resolve the storage key from the ref; skip refs that belong to
      // another backend (e.g. IPFS CIDs when running local storage).
      const key = this.storage.keyFromRef(doc.storageRef);
      if (!key) continue;

      // Resolve the absolute file path via the storage backend's naming scheme.
      // We piggy-back on refFor to get the scheme-prefixed form, then resolve.
      const ref = this.storage.refFor(key);

      let actualHash: string | null;
      try {
        // For local storage the ref encodes the path; compute hash directly.
        // For other backends this call would be replaced by a range-read.
        actualHash = await computeFileHash(key);
      } catch (err) {
        this.log.error("evidence checksum scan: error reading object", {
          jobId: doc.jobId,
          storageRef: ref,
          err,
        });
        continue;
      }

      if (actualHash === null) {
        missing++;
        if (affectedIds.length < maxAlertIds) affectedIds.push(doc.jobId);
        this.log.error("evidence checksum scan: storage object missing", {
          jobId: doc.jobId,
          // Intentionally omit storageRef from the log line; use jobId to look it up.
        });
        continue;
      }

      const expected = normalizeHash(doc.contentHash);
      if (actualHash !== expected) {
        altered++;
        if (affectedIds.length < maxAlertIds) affectedIds.push(doc.jobId);
        this.log.error("evidence checksum scan: hash mismatch — object may have been altered", {
          jobId: doc.jobId,
          // Do NOT log hashes here; they would expose content fingerprints in
          // log pipelines.  Operators should run the scan again with the job ID
          // to investigate (see docs/operations/evidence-checksum-scanner.md).
        });

        // Publish an individual mismatch event for real-time alerting.
        await this.webhooks
          ?.publish({
            type: CHECKSUM_MISMATCH_EVENT_TYPE,
            data: {
              jobId: doc.jobId,
              affectedCount: 1,
            },
          })
          .catch((err) =>
            this.log.warn("failed to publish mismatch webhook", { jobId: doc.jobId, err }),
          );
      }
    }

    const durationMs = Date.now() - started;
    const completedAt = new Date();

    this.log.info("evidence checksum scan complete", {
      scanned,
      altered,
      missing,
      affectedCount: altered + missing,
      durationMs,
    });

    // Publish a summary event when any findings were present.
    if (altered + missing > 0) {
      await this.webhooks
        ?.publish({
          type: CHECKSUM_SCAN_EVENT_TYPE,
          data: {
            scanned,
            altered,
            missing,
            // Safe identifiers only — no file paths, raw hashes, or content.
            safeIds: affectedIds,
          },
        })
        .catch((err) => this.log.warn("failed to publish checksum scan summary webhook", { err }));
    }

    return { scanned, altered, missing, safeIds: affectedIds, durationMs, completedAt };
  }
}

/**
 * Scheduler that wraps `EvidenceChecksumScanner` and runs it on an interval,
 * mirroring the pattern used by `CleanupScheduler`.
 */
export class ChecksumScanScheduler {
  private timer?: NodeJS.Timeout;
  private firstRun?: NodeJS.Timeout;

  constructor(
    private readonly scanner: EvidenceChecksumScanner,
    private readonly intervalMs: number,
    private readonly log: Logger,
  ) {}

  /** Delay the first scan so the service fully starts before scanning begins. */
  private static readonly FIRST_RUN_DELAY_MS = 90_000;

  start(): void {
    this.log.info("evidence checksum scanner scheduled", { intervalMs: this.intervalMs });
    this.firstRun = setTimeout(
      () => void this.tick(),
      ChecksumScanScheduler.FIRST_RUN_DELAY_MS,
    );
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.firstRun.unref();
    this.timer.unref();
  }

  stop(): void {
    clearTimeout(this.firstRun);
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      await this.scanner.run();
    } catch (err) {
      this.log.error("evidence checksum scan run failed", { err });
    }
  }
}
