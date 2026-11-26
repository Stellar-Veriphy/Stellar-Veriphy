# Dry-Run Batch Validation

`POST /api/admin/verifications/validate` validates a batch of verification
records and returns per-record outcomes without writing, updating, or
publishing any data.

## Request

```http
POST /api/admin/verifications/validate
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "jobIds":  ["job-123", "job-456"],   // optional: target specific records
  "cursor":  "2026-10-01T00:00:00Z",  // optional: keyset cursor from previous page
  "limit":   20                        // optional: 1–100, default 20
}
```

| Field | Required | Description |
|---|---|---|
| `jobIds` | No | Validate specific records. When omitted, all `certified` records are iterated. |
| `cursor` | No | ISO-8601 `createdAt` timestamp of the last record from the previous page. |
| `limit` | No | Records per page. Capped at 100. |

## Response

```json
{
  "dryRun": true,
  "total": 1842,
  "nextCursor": "2026-09-15T08:22:00.000Z",
  "results": [
    {
      "jobId": "job-123",
      "valid": true,
      "errors": []
    },
    {
      "jobId": "job-456",
      "valid": false,
      "errors": [
        "certId is required for certified records",
        "completedAt is required for certified records"
      ]
    }
  ]
}
```

| Field | Description |
|---|---|
| `dryRun` | Always `true`. |
| `total` | Total records matched by the query before pagination. |
| `nextCursor` | Pass as `cursor` to fetch the next page, or `null` on the last page. |
| `results[].jobId` | Record identifier. |
| `results[].valid` | Whether the record passes all validation rules. |
| `results[].errors` | Validation errors; empty when `valid` is `true`. |

## Validation rules

| Rule | Applies to |
|---|---|
| `contentHash` must be a 64-char hex SHA-256 (optionally `sha256:` prefixed) | All |
| `manifestHash` must be a 64-char hex SHA-256 | All |
| `creator` must be a valid Stellar G... public key (56 chars) | All |
| `storageRef` must be non-empty | All |
| `certId` required | `certified` |
| `txHash` required | `certified` |
| `completedAt` required | `certified`, `failed` |
| `error` / `errorCode` must be absent | `certified` |

## No-mutation guarantee

The endpoint reads from MongoDB and validates in memory.
No document is written, modified, or published at any point.

## Pagination example

```bash
# Page 1
curl -X POST /api/admin/verifications/validate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"limit": 50}'

# Page 2 — pass nextCursor from page 1
curl -X POST /api/admin/verifications/validate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"limit": 50, "cursor": "2026-09-15T08:22:00.000Z"}'
```

## Common error responses

| Status | Code | Meaning |
|---|---|---|
| 400 | — | Invalid `jobIds`, `cursor`, or `limit` |
| 401 | — | Missing or invalid admin token |
| 503 | `BATCH_VALIDATE_UNAVAILABLE` | Repository not configured (check startup logs) |
