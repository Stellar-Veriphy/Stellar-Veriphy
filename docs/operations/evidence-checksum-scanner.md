# Evidence Checksum Scanner

The checksum scanner periodically re-hashes every stored evidence object and
compares the result to the `contentHash` recorded in MongoDB.  Mismatches or
missing objects are logged at `error` level and published as webhook events.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CHECKSUM_SCANNER_ENABLED` | `true` | Enable or disable the scanner entirely |
| `CHECKSUM_SCANNER_INTERVAL_MINUTES` | `360` (6 h) | How often to run a full scan |
| `CHECKSUM_SCANNER_BATCH_SIZE` | `50` | Records processed per cursor batch |
| `CHECKSUM_SCANNER_MAX_ALERT_IDS` | `100` | Max job IDs included in a single alert payload |

The scanner also requires `MEDIA_STORAGE_DIR` to be set (the same variable
that enables orphan media cleanup).

## Triggering a manual scan

```bash
curl -X POST /admin/maintenance/checksum-scan \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Returns a `ChecksumScanResult`:

```json
{
  "scanned": 2341,
  "altered": 0,
  "missing": 1,
  "safeIds": ["job-abc123"],
  "durationMs": 4201,
  "completedAt": "2026-11-01T10:05:22.000Z"
}
```

| Field | Description |
|---|---|
| `scanned` | Total certified records examined |
| `altered` | Records whose recomputed hash no longer matches `contentHash` |
| `missing` | Records whose storage file no longer exists |
| `safeIds` | Job IDs of affected records (never raw paths or hash values) |
| `durationMs` | Wall-clock duration of the scan |
| `completedAt` | When the scan finished |

## Webhook events

### `evidence.checksum.scan_complete`

Published after any scan that found at least one finding:

```json
{
  "id": "evt_...",
  "type": "evidence.checksum.scan_complete",
  "createdAt": "...",
  "data": {
    "scanned": 2341,
    "altered": 1,
    "missing": 0,
    "safeIds": ["job-abc123"]
  }
}
```

### `evidence.checksum.mismatch`

Published for each individual mismatch as it is detected:

```json
{
  "type": "evidence.checksum.mismatch",
  "data": {
    "jobId": "job-abc123",
    "affectedCount": 1
  }
}
```

## Read-only guarantee

The scanner **never modifies** a file.  The only operations performed are:

1. MongoDB cursor read (`find`, `batchSize`)
2. `fs.createReadStream` to compute the SHA-256 hash
3. Log writes
4. Webhook publishes

If a mismatch is found, **do not** attempt to restore the file automatically.
Contact the security team first; the original evidence must be recovered from
a trusted backup to maintain the chain of custody.

## Investigating a finding

1. Note the `jobId` from the alert.
2. Look up the verification: `GET /api/verifications/<jobId>`
3. Retrieve the `storageRef` and locate the file in your storage backend.
4. Compare the actual hash against `contentHash` manually.
5. If altered: treat as a potential security incident; escalate.
6. If missing: check backup systems; restore from the most recent snapshot.

## Distributed locking

Only one instance runs a scan at a time.  If the lock holder crashes the
lock expires after 30 minutes, allowing the next instance to proceed.
A skipped scan is logged at `debug` level and is not an error.
