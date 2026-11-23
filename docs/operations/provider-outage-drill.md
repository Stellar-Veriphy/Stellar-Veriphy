# Verification Provider Outage Drill

This document describes a **scheduled, repeatable drill** that simulates an outage of the
external verification provider(s) and validates that alerts fire, degraded modes engage,
and fallback procedures work as intended.

Run this drill at least **quarterly**, and after any change to verification provider
integration, alerting rules, or fallback logic.

Related: `docs/operations`, `monitoring`.

---

## 1. Purpose & Scope

- Simulate a verification provider outage (full outage and partial/slow degradation).
- Confirm that Prometheus alerts fire and reach the on-call channel.
- Confirm that the application enters its documented degraded mode and that fallback
  procedures behave as designed.
- Capture results and identify follow-up improvements.

**Out of scope:** changing production data, real provider contracts, or anything that
affects real users beyond the controlled drill window.

---

## 2. Prerequisites

- Access to the environment where the drill will run (staging preferred; production only
  with explicit approval and during a low-traffic window).
- Access to Prometheus / Alertmanager UI and the on-call notification channel.
- Access to the health endpoints of the verification service (see §6).
- A designated **drill lead** and an **observer** (the observer records timings and results).
- A way to simulate the outage (see §3). Choose the least invasive method that still
  exercises the real failure path.

---

## 3. Simulating the Outage

Pick **one** method per drill run and record which one was used.

1. **Network block / firewall rule** — block egress from the verification service to the
   provider host(s). Most realistic; exercises timeouts and retries.
2. **DNS override** — point the provider hostname to an unreachable address in the
   service's DNS/hosts configuration.
3. **Provider stub / mock** — configure the service to use a stub that returns errors
   (5xx) or times out. Good for staging.
4. **Feature flag / config toggle** — if the service supports a "provider disabled" flag,
   use it to force the degraded path.

For a **partial degradation** scenario, use the stub to return slow responses or a mix of
successes and failures instead of a hard outage.

> Always note the exact method, target, and start/end times so the drill is repeatable.

---

## 4. Drill Procedure

Follow the steps in order. Record timings for each step in the results template (§7).

### Step 1 — Baseline

- Confirm the system is healthy: check the health endpoints (§6) and confirm no active
  verification alerts in Alertmanager.
- Record the baseline: current error rate, latency, and queue depth for verification.

### Step 2 — Simulate the outage

- Apply the chosen simulation method (§3).
- Note the exact start time (UTC).

### Step 3 — Observe alerts

- Watch Prometheus / Alertmanager for the verification alerts (§5) to fire.
- Confirm the alert reaches the on-call notification channel.
- Record: which alerts fired, time-to-fire, and whether the notification was received.

### Step 4 — Verify degraded mode

- Confirm the application entered its documented degraded mode:
  - Verification requests are queued, retried, or rejected per policy (not silently lost).
  - User-facing behavior matches the documented fallback (e.g. "verification pending"
    state, clear messaging, no crashes).
  - Health endpoints report the degraded state (§6).
- Record observed behavior vs. expected behavior.

### Step 5 — Restore

- Remove the simulation (unblock network, revert DNS, disable stub, re-enable provider).
- Note the exact end time (UTC).
- Confirm the system recovers: alerts resolve, queues drain, health endpoints return to
  healthy, and normal verification resumes.

### Step 6 — Record results

- Fill in the results template (§7).
- File follow-up improvements as issues and link them from the results record.
- Store the completed record alongside this document (or in the team's runbook store).

---

## 5. Relevant Alerts

Confirm the following Prometheus alerts (names may vary slightly by deployment) fire and
resolve as expected. Check the actual rule files under `monitoring/` for the authoritative
definitions.

| Alert | Meaning | Expected during drill |
| --- | --- | --- |
| `VerificationProviderDown` | Provider unreachable / health check failing | Fires during full outage |
| `VerificationProviderHighErrorRate` | Elevated 5xx / error responses from provider | Fires during error-injection |
| `VerificationProviderHighLatency` | Provider response time above threshold | Fires during slow/stub scenario |
| `VerificationQueueBacklog` | Verification queue depth growing | Fires if requests are queued |
| `VerificationServiceDegraded` | Service reports degraded mode | Fires when degraded mode engages |

Also confirm that alerts **resolve** after restore (Step 5).

---

## 6. Health Endpoints

Check these endpoints before, during, and after the drill:

- `GET /health` — overall liveness/readiness.
- `GET /health/verification` (or the verification-specific health path) — reports provider
  connectivity and degraded state.
- `GET /metrics` — Prometheus metrics for verification (error rate, latency, queue depth).

Record the status/response observed at each phase.

---

## 7. Results Template

Copy this template for each drill run.

```
# Verification Provider Outage Drill — Results

- Date (UTC):
- Environment:
- Drill lead:
- Observer:
- Simulation method: (network block / DNS override / stub / feature flag)
- Scenario: (full outage / partial degradation / slow responses)
- Start time (UTC):
- End time (UTC):

## Timeline
| Step | Expected | Observed | Time (UTC) | Pass/Fail |
| --- | --- | --- | --- | --- |
| Baseline healthy | | | | |
| Outage simulated | | | | |
| Alerts fired | | | | |
| Notification received | | | | |
| Degraded mode engaged | | | | |
| Restore completed | | | | |
| Alerts resolved | | | | |
| System healthy | | | | |

## Alerts Observed
- Fired:
- Time-to-fire:
- Resolved:
- Notification channel received: yes/no

## Degraded Mode Validation
- Expected behavior:
- Observed behavior:
- Data integrity (no lost verifications): yes/no

## Follow-up Improvements
| # | Finding | Severity | Owner | Issue link |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |

## Overall Result
- Pass / Partial / Fail:
- Notes:
```

---

## 8. Follow-up

- Review the completed results with the team.
- Prioritize and assign follow-up improvements; link them to the drill record.
- Update this document if the procedure, alerts, or endpoints change.
- Schedule the next drill.