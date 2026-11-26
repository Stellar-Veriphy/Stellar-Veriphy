# Soft deletion and record recovery

> Labels: backend, operations

Verification records are user-facing audit trails and are never touched by
normal retention cleanup. When an operator needs to hide a record immediately
(e.g. for a legal take-down or accidental submission), **soft deletion** marks
it invisible to all public API reads without destroying it. An authorized
operator can recover it within the retention window.

## How it works

### Soft deletion

`POST /admin/verifications/:jobId/soft-delete` (admin token required)

Body: `{ "reason": "..." }` (required, max 500 characters)

- Marks the live record in `verifications` with `softDeletedAt`, `softDeletedBy`,
  and `softDeleteReason`.
- Writes a full snapshot to `soft_deleted_verifications` for audit and recovery.
- Both operations run in a MongoDB transaction; a crash leaves them consistent.
- Writes an audit event to `security_audit_events` (`verification.soft_deleted`).
- All public read endpoints (`GET /api/verifications/:jobId`, content-hash lookup,
  creator listing, certificate lookup) immediately return 404 for the record.

### Recovery

`POST /admin/verifications/:jobId/recover` (admin token required)

- Removes soft-delete fields from the live record — it reappears instantly in all
  public reads.
- Stamps the snapshot with `recoveredAt` and `recoveredBy`.
- Writes an audit event (`verification.recovered`).
- Returns 409 if the record is not currently soft-deleted, or has already been
  recovered.

### Listing soft-deleted records

`GET /admin/verifications/soft-deleted` (admin token required)

Query parameters:

| Parameter | Default | Description |
|---|---|---|
| `limit` | 50 | Max results (ceiling: 200) |
| `includeRecovered` | false | Include already-recovered deletions |

Returns `{ items: [...] }` with summary fields (jobId, status, creator,
softDeletedAt, softDeletedBy, softDeleteReason, recoveredAt, recoveredBy).

## Retention policy

Soft-deleted snapshots in `soft_deleted_verifications` are permanently purged
by the `purge_soft_deleted_verifications` retention task after **90 days**
(hard-coded in `cleanup.ts`). After that window the record cannot be recovered.

The live record in `verifications` remains indefinitely regardless — it only
loses the soft-delete markers on recovery, or persists with them forever if
never recovered. The `verifications` collection is on the protection allow-list
deny-list and is never touched by any retention task.

## Audit trail

Every soft-delete and recovery writes an event to `security_audit_events`:

| Event | Fields |
|---|---|
| `verification.soft_deleted` | jobId, deletedBy (IP), reason |
| `verification.recovered` | jobId, recoveredBy (IP) |

These events are included in audit exports (`POST /admin/audit-exports/:jobId`).

## Permission model

Both endpoints require the admin token (`Authorization: Bearer <ADMIN_TOKEN>`).
There is no separate "can soft-delete" vs "can recover" permission — both are
restricted to the same admin tier. If finer-grained control is needed, it
should be implemented as a separate access scope in the access-request system.
