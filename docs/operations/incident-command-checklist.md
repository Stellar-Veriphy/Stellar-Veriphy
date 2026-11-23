# Incident Command Checklist Template

> **Purpose:** A reusable checklist for managing security and operational incidents from detection through recovery. Complete this document during every incident so that the result is an auditable incident record.
>
> **Related documents:** [`SECURITY.md`](../../SECURITY.md) · [Incident Communication Guide](./incident-communication.md)

---

## 1. Incident Overview

| Field | Value |
|---|---|
| Incident ID | |
| Incident Title | |
| Date/Time Detected (UTC) | |
| Detected By | |
| Severity (SEV1–SEV4) | |
| Current Status | Open / Contained / Recovering / Closed |
| Incident Commander | |

---

## 2. Roles and Required Decisions

Assign each role at incident start. Every role must record the decisions it owns in the Decision Log (Section 6).

### Incident Commander (IC)
- **Responsibilities:** Owns the incident end-to-end; coordinates all roles; declares severity and status changes.
- **Required decisions:**
  - [ ] Declare incident severity level.
  - [ ] Assemble the response team and assign roles.
  - [ ] Approve containment and recovery actions.
  - [ ] Declare incident resolved and authorize closure.

### Scribe
- **Responsibilities:** Maintains the timeline and decision log; captures all actions and evidence references.
- **Required decisions:**
  - [ ] Confirm timeline entries are complete and timestamped (UTC).
  - [ ] Verify all decisions and evidence references are recorded.
  - [ ] Confirm the incident record is complete before closure.

### Communications Lead
- **Responsibilities:** Owns internal and external messaging; coordinates with Legal Liaison on disclosures.
- **Required decisions:**
  - [ ] Determine internal notification audience and cadence.
  - [ ] Decide whether external/customer communication is required (with Legal Liaison).
  - [ ] Approve final messaging before release.

### Security Lead
- **Responsibilities:** Leads technical investigation, containment, and evidence preservation.
- **Required decisions:**
  - [ ] Determine scope and root cause of the security impact.
  - [ ] Approve containment strategy (isolate, block, revoke credentials).
  - [ ] Confirm evidence preservation steps are complete.
  - [ ] Recommend remediation and follow-up actions.

### Legal Liaison
- **Responsibilities:** Advises on legal, regulatory, and contractual obligations.
- **Required decisions:**
  - [ ] Determine whether regulatory notification is required (and deadlines).
  - [ ] Determine whether law enforcement or external counsel must be engaged.
  - [ ] Approve handling of privileged or sensitive information.
  - [ ] Confirm evidence retention requirements.

### Engineering Lead
- **Responsibilities:** Directs engineering response, recovery, and restoration of service.
- **Required decisions:**
  - [ ] Approve technical remediation and rollback plans.
  - [ ] Confirm recovery criteria are met before restoring service.
  - [ ] Assign owners for post-incident engineering follow-ups.

---

## 3. Triage

- [ ] Confirm the incident is real and not a false positive.
- [ ] Record detection source, time (UTC), and initial indicators.
- [ ] Assign severity per the severity matrix.
- [ ] Identify affected systems, data, and users (initial scope).
- [ ] Assign all roles (Section 2).
- [ ] Open the incident record and start the timeline (Section 6).
- [ ] Notify on-call stakeholders per escalation policy.

**Required decisions:** Severity declaration (IC); initial scope (Security Lead); notification audience (Communications Lead).

---

## 4. Communications

- [ ] Establish communication channel (bridge/war room) and record its location.
- [ ] Send initial internal notification with severity and status.
- [ ] Define update cadence and next update time.
- [ ] Draft external/customer messaging if required (Legal Liaison approval).
- [ ] Record all communications sent in the timeline.

**Required decisions:** External disclosure required? (Communications Lead + Legal Liaison); messaging approval (Communications Lead).

---

## 5. Evidence Preservation

- [ ] Identify and label all evidence sources (logs, disk images, memory, network captures).
- [ ] Capture evidence before remediation where feasible.
- [ ] Record chain-of-custody details (who, what, when, where stored).
- [ ] Store evidence in a secure, access-controlled location.
- [ ] Confirm retention requirements with Legal Liaison.
- [ ] Reference each evidence item by ID in the incident record.

**Required decisions:** Evidence scope and preservation method (Security Lead); retention requirements (Legal Liaison).

---

## 6. Recovery

- [ ] Confirm containment is effective.
- [ ] Execute approved remediation/rollback plan.
- [ ] Verify recovery criteria are met (health checks, monitoring, validation).
- [ ] Restore service and monitor for recurrence.
- [ ] Confirm no residual compromise or exposed credentials.
- [ ] Schedule post-incident review and assign follow-up owners.

**Required decisions:** Recovery criteria met (Engineering Lead); service restoration approval (IC); follow-up ownership (Engineering Lead).

---

## 7. Consideration Checklists

### Legal
- [ ] Regulatory notification obligations assessed.
- [ ] Contractual/customer notification obligations assessed.
- [ ] Privileged information handling confirmed.
- [ ] Evidence retention requirements confirmed.
- [ ] Law enforcement / external counsel engagement decided.

### Security
- [ ] Root cause identified or investigation plan documented.
- [ ] Containment verified.
- [ ] Credentials/secrets rotated where exposed.
- [ ] Evidence preserved and referenced.
- [ ] Detection gaps and hardening actions identified.

### Engineering
- [ ] Remediation and rollback plans approved.
- [ ] Recovery validated with monitoring.
- [ ] Post-incident engineering actions assigned with owners and due dates.
- [ ] Runbooks/documentation updated as needed.

---

## 8. Auditable Incident Record

Complete this section before closing the incident. This record is the authoritative audit artifact.

### 8.1 Timeline

| Timestamp (UTC) | Actor | Role | Action / Event |
|---|---|---|---|
| | | | |
| | | | |

### 8.2 Decision Log

| Timestamp (UTC) | Decision | Decided By (Role) | Rationale |
|---|---|---|---|
| | | | |
| | | | |

### 8.3 Evidence References

| Evidence ID | Description | Location / Storage | Collected By | Timestamp (UTC) |
|---|---|---|---|---|
| | | | | |
| | | | | |

### 8.4 Sign-Offs

| Role | Name | Sign-Off (UTC) |
|---|---|---|
| Incident Commander | | |
| Scribe | | |
| Communications Lead | | |
| Security Lead | | |
| Legal Liaison | | |
| Engineering Lead | | |

**Incident closed by (IC):** ____________________  **Date (UTC):** ______________

---

## 9. References

- [`SECURITY.md`](../../SECURITY.md) — security policy and reporting procedures.
- [Incident Communication Guide](./incident-communication.md) — communication templates and escalation paths.