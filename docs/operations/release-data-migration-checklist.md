# Release Data Migration Checklist

Standard checklist for any release that includes schema changes or indexed data migrations.

Use this checklist for every release that touches database schema, migrations, or indexed/derived data. Copy the checkbox list into the release PR and have it completed before the release is approved.

Related procedures:

- [DEPLOYMENT.md](../../DEPLOYMENT.md)
- [docs/deployment.md](../deployment.md)

---

## 1. Pre-Release Backups

Complete **before** running any migration.

### What to back up

- [ ] Primary database (full logical or physical backup, per environment policy)
- [ ] Any indexed/derived data stores affected by the migration
- [ ] Migration state / schema version metadata (e.g. current migration table snapshot)
- [ ] Configuration and environment variables required to restore the above

### Where to store backups

- [ ] Backup written to the designated backup location for the environment (document the path/URI below)
- [ ] Backup retained for at least the rollback window defined in [DEPLOYMENT.md](../../DEPLOYMENT.md)

Backup location / URI: `_______________________`

### Verify backup integrity

- [ ] Backup completed without errors (check backup job logs)
- [ ] Backup checksum or size verified against source
- [ ] Restore tested (at minimum into a scratch/staging instance) **or** restore procedure confirmed with the data owner
- [ ] Backup timestamp recorded below

Backup timestamp / ID: `_______________________`

---

## 2. Migration Validation

Run validation tooling **before** promoting the release.

- [ ] Run `scripts/migrations/validate.sh` — all checks pass
- [ ] Run `scripts/upgrade-safety-check.sh` — all checks pass
- [ ] Migration tested against a copy of production-like data
- [ ] Expected runtime and locking behavior reviewed (long-running or locking migrations scheduled appropriately)
- [ ] Validation output attached to the release PR

Validation output / link: `_______________________`

---

## 3. Rollback Steps

Rollback must be rehearsed or documented before release. If any step fails, escalate to the data owner and approvers listed below.

1. **Restore from backup**
   - [ ] Stop application traffic / put service into maintenance mode
   - [ ] Restore the database (and indexed data stores) from the verified backup in Section 1
   - [ ] Verify restored data integrity (row counts, checksums, spot checks)
2. **Revert migration**
   - [ ] Run the down/revert migration if a safe revert exists
   - [ ] If no safe revert exists, the restore in step 1 is the rollback path — confirm this is acceptable
3. **Redeploy previous contract**
   - [ ] Redeploy the previous application/contract version that matches the restored schema
   - [ ] Confirm service health and smoke tests pass
   - [ ] Record rollback outcome in the release PR

Rollback rehearsed? [ ] Yes [ ] No — if No, explain: `_______________________`

---

## 4. Data Ownership

Every affected data set must have a named owner who is accountable for its integrity and migration.

| Data set | Owner (name) | Contact | Notes |
|----------|--------------|---------|-------|
|          |              |         |       |
|          |              |         |       |

- [ ] All affected data sets have a named owner
- [ ] Owners have reviewed the migration plan

---

## 5. Required Approvals

### Before release

- [ ] Data owner(s) sign off on the migration plan and backup verification
- [ ] Engineering reviewer approves the release PR
- [ ] Operations/deployment owner confirms backup and rollback readiness

### After release

- [ ] Data owner(s) confirm post-migration data integrity (validation re-run, spot checks)
- [ ] Operations/deployment owner confirms service health and closes out the release

| Approval | Name | Role | Date |
|----------|------|------|------|
| Pre-release — data owner |      |      |      |
| Pre-release — engineering |      |      |      |
| Pre-release — operations |      |      |      |
| Post-release — data owner |      |      |      |
| Post-release — operations |      |      |      |

---

## Copy-Ready Checklist for Release PR

```markdown
## Release Data Migration Checklist

### Pre-release backups
- [ ] Primary database backed up
- [ ] Indexed/derived data stores backed up
- [ ] Migration state / schema version snapshot taken
- [ ] Backup stored at: <location/URI>
- [ ] Backup integrity verified (checksum/size, restore tested)
- [ ] Backup timestamp/ID: <value>

### Migration validation
- [ ] `scripts/migrations/validate.sh` passes
- [ ] `scripts/upgrade-safety-check.sh` passes
- [ ] Tested against production-like data
- [ ] Validation output attached

### Rollback
- [ ] Restore-from-backup procedure confirmed
- [ ] Migration revert path confirmed (or restore-only rollback accepted)
- [ ] Previous contract/version identified for redeploy
- [ ] Rollback rehearsed: Yes/No

### Data ownership
- [ ] Named owner per affected data set (list below)
  - <data set> — <owner>

### Approvals
- [ ] Pre-release: data owner sign-off
- [ ] Pre-release: engineering review
- [ ] Pre-release: operations/deployment readiness
- [ ] Post-release: data owner integrity confirmation
- [ ] Post-release: operations close-out

See DEPLOYMENT.md and docs/deployment.md for deployment procedures.