# Secret Rotation Rehearsal Runbook

This runbook describes how to rehearse rotating service credentials without downtime or secret exposure. It applies to all credentials inventoried in `config/environments/production.json` and `config/environments/staging.json`.

Related: `docs/security`, `SECURITY.md`.

## Goals

- Rotation steps preserve service availability.
- Old credentials are revoked on a defined schedule.
- Rehearsal output never contains secret values.

## Prerequisites

1. **Credential inventory.** Confirm the current inventory of service credentials from:
   - `config/environments/production.json`
   - `config/environments/staging.json`
   Record only credential *names/keys* and owning services — never values.
2. **Audit logging.** Ensure `scripts/ops/config-audit.sh` is available and runnable. It records configuration audit events (who changed what, when) without emitting secret values.
3. **Access.** You have write access to the secret store and deploy/config pipeline for the target environment.
4. **Rehearsal window.** Schedule the rehearsal in a low-traffic window. Staging first, then production.
5. **Rollback plan.** Know how to restore the previous credential version from the secret store if a step fails.
6. **Redaction confirmed.** Verify logging/redaction rules below are in effect before starting.

## Redaction Rules (mandatory)

Rehearsal output must never print secret values. Apply these rules throughout:

- Never `echo`, `cat`, `printenv`, or `set -x` any secret value or secret-bearing file.
- When referencing a credential, print only its **name** and a **fingerprint** (e.g., first 4 chars of a SHA-256 hash), never the value.
- Redirect command output that could contain secrets to `/dev/null` or through a redaction filter.
- Disable shell tracing (`set +x`) around any command that touches secrets.
- Use `scripts/ops/config-audit.sh` for audit logging; it is designed to log metadata only.
- Review captured rehearsal logs before sharing; grep for known secret prefixes and confirm none appear.
- If a secret is accidentally exposed, stop, rotate it immediately, and follow `SECURITY.md` incident reporting.

## Rotation Procedure (dual-credential, zero downtime)

The core principle: **old and new credentials are active simultaneously** during the cutover, so services never lose access.

1. **Announce start.** Note the rehearsal start time and the credential being rotated (name only).
2. **Create new credential.** Generate the new credential in the secret store alongside the existing one. Do not delete or overwrite the old one.
3. **Enable both.** Ensure the target service accepts both old and new credentials (dual-active window). Verify the service's auth layer supports multiple valid credentials.
4. **Deploy new credential.** Roll out the new credential to consumers via the config pipeline. Confirm the deployment references the new credential name.
5. **Verify health.** Confirm services remain healthy:
   - Health/readiness checks pass.
   - Error rates and auth failures are unchanged.
   - A representative request succeeds using the new credential.
6. **Observe.** Keep both credentials active through the observation window (see timeline) to catch stragglers or cached clients.
7. **Revoke old credential on schedule.** After the observation window, revoke the old credential per the timeline below.
8. **Verify post-revocation health.** Confirm services still pass health checks with only the new credential active.
9. **Record audit.** Run `scripts/ops/config-audit.sh` to log the rotation event (metadata only).

## Revocation Timeline

| Phase | Duration | Old credential | New credential |
|-------|----------|----------------|----------------|
| Create & enable | T+0 | Active | Active |
| Deploy & verify | T+0 to T+1h | Active | Active |
| Observation window | T+1h to T+24h | Active | Active |
| Scheduled revocation | T+24h | **Revoked** | Active |
| Post-revocation check | T+24h to T+25h | Revoked | Active |

- Minimum observation window: **24 hours** for production, **1 hour** for staging.
- Revocation is scheduled, not immediate, to allow cached clients and in-flight sessions to drain.
- If any health check fails during observation, extend the window and investigate before revoking.

## Rehearsal Checklist

- [ ] Credential inventory reviewed from `production.json` / `staging.json` (names only).
- [ ] `scripts/ops/config-audit.sh` available and audit logging confirmed.
- [ ] Redaction rules reviewed; shell tracing disabled around secret operations.
- [ ] New credential created alongside old (old not deleted).
- [ ] Dual-active window confirmed on target service.
- [ ] New credential deployed to consumers.
- [ ] Health checks pass with both credentials active.
- [ ] Observation window completed (staging 1h / production 24h).
- [ ] Old credential revoked on schedule.
- [ ] Health checks pass with only new credential active.
- [ ] Rotation event recorded via `scripts/ops/config-audit.sh`.
- [ ] Rehearsal logs reviewed and confirmed free of secret values.
- [ ] Findings and timing recorded for the next rotation.

## Notes

- Rehearse in staging before production.
- Keep this runbook in sync with the credential inventory in `config/environments/*.json`.
- Report any exposure or anomaly per `SECURITY.md`.