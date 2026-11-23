# Staging Smoke Test Sign-Off

This document defines the sign-off record required before promoting a build from staging to production. A concise sign-off confirms that critical staging checks have been run, records who reviewed them, and documents the outcome.

## Purpose

Before any production promotion, the staging smoke tests must be executed and reviewed. The sign-off record captures:

- **Test scope** — which checks were run
- **Reviewer** — who reviewed the results
- **Timestamp** — when the sign-off was recorded
- **Pass/fail per check** — the outcome of each check
- **Exception justification** — required when a failed check is waived

## Running the smoke tests

The smoke tests are executed by the script at [`scripts/ci/smoke-test.sh`](../../scripts/ci/smoke-test.sh). Run it against the staging environment and capture the output for the sign-off record.

```bash
./scripts/ci/smoke-test.sh
```

## Sign-off record

Record the sign-off using the following template. Attach or link the smoke-test output alongside it.

```markdown
### Staging Smoke Test Sign-Off

- **Build / version:**
- **Environment:** staging
- **Reviewer:** (name / handle)
- **Timestamp:** (ISO 8601, e.g. 2025-01-31T14:05:00Z)
- **Test scope:** (list of checks run, or "full suite" with a link to output)

| Check | Result | Notes |
|-------|--------|-------|
| (check name) | PASS / FAIL | |
| (check name) | PASS / FAIL | |

- **Overall result:** PASS / FAIL
- **Exception justification:** (required if any check FAILED and promotion is to proceed)
```

## Promotion gating

By default, **any failed check blocks promotion to production.** The staging-signoff workflow enforces this: a sign-off with an overall result of `FAIL` (or any individual `FAIL` without an approved exception) will not permit promotion.

## Emergency exceptions

In an emergency, promotion may proceed despite a failed check, but only through the documented exception path:

1. Apply the `staging-signoff-exception` label to the pull request or promotion request.
2. Record a written **exception justification** in the sign-off record explaining:
   - which check(s) failed,
   - the impact and risk of proceeding,
   - why the fix cannot wait for a normal promotion cycle,
   - any follow-up actions and their owners.

The exception must be reviewed and acknowledged by a second reviewer before promotion. Exceptions are logged for post-incident review.

## Related resources

- Smoke test script: [`scripts/ci/smoke-test.sh`](../../scripts/ci/smoke-test.sh)
- Sign-off workflow: [`.github/workflows/staging-signoff.yml`](../../.github/workflows/staging-signoff.yml)
- Deployment docs: [`docs/deployment`](./)