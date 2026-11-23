# Backup Restore Test Schedule

This document describes the automated backup restore testing process for production and staging data sets. Restore tests verify that backups are usable, complete, and consistent, and that failures produce actionable follow-up work.

## Purpose

Backups are only useful if they can be restored. This process:

- Runs periodic restore tests against representative production and staging data sets.
- Executes restores in isolated environments so live systems are never touched.
- Verifies key record counts and integrity checks after restore.
- Converts failures into actionable follow-up work (tracked issues and alerts).

## Cadence

| Data set | Frequency | Window | Owner |
| --- | --- | --- | --- |
| Production (representative subset) | Weekly | Sunday 02:00 UTC | Operations on-call |
| Production (full snapshot, sampled) | Monthly | First Sunday 02:00 UTC | Operations on-call |
| Staging | Weekly | Wednesday 02:00 UTC | Platform team |

- **Production:** a representative subset is restored weekly; a full snapshot is restored monthly to catch issues that only appear at full scale.
- **Staging:** restored weekly to validate the pipeline end to end with the most recent schema and data.
- Ad-hoc restore tests may be run manually before major releases or schema migrations.

## Isolated Environment Setup

Restore tests must never run against production or staging directly.

1. **Provision an isolated environment.** Use a dedicated, ephemeral database instance (container or managed instance) in a separate network/namespace from production and staging. The environment must have no network path to production data stores.
2. **Fetch the backup.** Retrieve the most recent backup artifact for the target data set from backup storage.
3. **Restore into the isolated instance.** Run the restore using the standard procedure for the database engine.
4. **Run verification checks** (see below) against the restored instance.
5. **Tear down.** Destroy the isolated environment and any temporary credentials after the run, regardless of outcome.

The restore procedure is implemented in [`scripts/ops/restore-test.sh`](../../scripts/ops/restore-test.sh). The script provisions the isolated environment, performs the restore, runs the verification checks, and reports results. See [DEPLOYMENT.md](../../DEPLOYMENT.md) for environment configuration, credentials, and deployment conventions used by the script.

## Verification Checks

After a restore completes, the following checks are performed against the restored data:

### Record counts

- Row counts for key tables (users, accounts, orders, and other core entities) are compared against the expected counts recorded at backup time.
- Counts must match within the configured tolerance (default: exact match for core tables; small tolerance for high-churn tables).

### Integrity checks

- Database-level integrity checks (e.g. `pg_dump`/`pg_restore` exit status, foreign key validation, index consistency).
- Referential integrity: no orphaned rows in key relationships.
- Schema version matches the expected migration version.
- Spot-check queries for representative records return expected values.

A restore test passes only if all record-count and integrity checks succeed.

## Failure Handling and Follow-Up Work

When a restore test fails:

1. **Alert.** The script exits non-zero and emits a failure notification to the operations channel, including the failing check and relevant logs.
2. **Create a tracked issue.** A follow-up issue is automatically created (or the run is linked to an existing one) with:
   - The data set and backup artifact tested.
   - The failing check(s) and error output.
   - Links to logs and the CI/scheduler run.
   - Suggested next steps (e.g. re-run, investigate backup corruption, verify credentials).
3. **Assign ownership.** The issue is assigned to the operations on-call for production failures and to the platform team for staging failures.
4. **Escalation.** Repeated failures (two consecutive runs) are escalated to the database reliability owner.

Follow-up work is not considered complete until a subsequent restore test passes.

## Scheduling and CI Integration

The restore test schedule is wired into CI/scheduling as follows:

- **CI:** The restore test runs as a scheduled pipeline job (see the CI configuration for the `restore-test` job), invoking [`scripts/ops/restore-test.sh`](../../scripts/ops/restore-test.sh) with the target data set.
- **Scheduler:** For environments outside CI, a scheduler (cron or the platform scheduler) triggers the same script on the cadence defined above.
- **Reporting:** Results are recorded per run and surfaced in the operations dashboard; failures trigger the follow-up process described above.

Refer to [DEPLOYMENT.md](../../DEPLOYMENT.md) for how the script is configured and deployed in each environment.