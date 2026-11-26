# Incident Severity and Escalation Policy

> **Purpose:** Define severity levels, escalation timing, ownership, and customer communication
> guidance for verification, security, and availability incidents.
>
> **Related:** [`incident-command-checklist.md`](./incident-command-checklist.md) · [`incident-communication.md`](./incident-communication.md) · [`SECURITY.md`](../../SECURITY.md)

---

## 1. Severity Levels

| Level | Impact Classification | Response Expectation | Example Scenarios |
| --- | --- | --- | --- |
| **SEV1 — Critical** | Complete service outage or data integrity compromise. Potential exposure of sensitive data or cryptographic keys. | First response within **15 minutes**. Continuous attention until resolved. Update cadence **every 30 minutes**. | All verification services down; blockchain network fork; suspected key exposure; mass data leak |
| **SEV2 — High** | Partial outage affecting core functionality. Significant delays in verification processing. | First response within **30 minutes**. Active response until mitigated. Update cadence **every 60 minutes**. | Verification submissions failing; certificate API timeouts; wallet connection failures; partial network outage |
| **SEV3 — Medium** | Degraded performance with workaround available. Limited impact on user operations. | First response within **4 hours**. Business-day updates acceptable. | Slow verification processing; occasional timeouts; search/filter issues; minor UI bugs |
| **SEV4 — Low** | Cosmetic issues, documentation errors, or minor inconveniences. | Next business day response. Weekly updates if ongoing. | Typos; outdated links; minor display issues; non-blocking performance degradations |

---

## 2. Escalation Timing

| Trigger | Escalation Action |
| --- | First responder contacts maintainers via operational roster. If no acknowledgment within **15 minutes**, escalate to secondary maintainers. |
| **No acknowledgment after 15 min** | First responder directly contacts next available maintainer; repeat every 15 minutes until someone accepts incident command. |
| **SEV1 or security incident** | Immediately notify security lead and component owners privately. Do not discuss details in public channels until approved. |
| **Escalation during off-hours** | Use on-call rotation. If on-call unreachable, use backup contact from operational roster. Log all escalation attempts. |

---

## 3. Ownership and Roles

### Incident Commander (IC)
- Owns severity declaration and final closure authority
- Coordinates all response roles
- Approves external communications
- **Fallback:** If IC is unavailable, next senior maintainer assumes command

### Technical Lead
- Directs investigation and remediation
- Assesses root cause and recovery options
- Validates recovery criteria before service restoration

### Communications Lead
- Manages internal and external messaging
- Coordinates with Legal Liaison on disclosures
- Owns customer communication timing and content

### Security Lead (SEV1 / security incidents)
- Leads evidence preservation and forensic analysis
- Determines scope of exposure
- Recommends containment actions

| Escalation Channel | When to Use | Contact Method |
| --- | --- | --- |
| Primary maintainer | Initial response | Operational roster (private) |
| Secondary maintainer | No primary response in 15 min | Direct contact from roster |
| Security team | Security incident or data exposure | Private security channel |
| Legal liaison | Regulatory notification, disclosure approval | Direct contact |

---

## 4. Customer Communication Guidance

### Communication Principles
- Use **UTC timestamps** in all public communications
- Reference incident ID (`INC-YYYYMMDD-NN`) in all notices
- Communicate facts promptly—do not wait for root cause
- Always provide next update time, even if "no change"
- Never expose sensitive evidence, logs, or PII in public

### Content Guidelines

| Severity | Initial Notice Timeline | Required Information |
| --- | --- | :--- |
| SEV1 | Within 15 minutes | Impact scope, known start time, workaround, next update |
| SEV2 | Within 30 minutes | Affected features/networks, current status, next update |
| SEV3 | Within 4 hours | Issue description, expected resolution, timeline |
| SEV4 | Next business day | Issue acknowledgment, planned fix date |

### Customer-Facing Channels
1. **Application banner** — displayed on site when available
2. **GitHub issue** — canonical status thread (`[Incident INC-ID]`)
3. **Support channels** — configured status page or mailing list
4. **Direct notification** — only for affected users with verified contact methods (requires Legal approval)

### Messaging Template
```
[INC-ID] [Status] — [UTC timestamp]
Impact: [affected features, networks, start time, symptoms]
User action: [safe workaround or "no action required"]
Progress: [confirmed facts; recovery estimate only when supported]
Next update: [UTC time]
Status: [link to canonical thread]
```

---

## 5. Verification-Specific Escalation

| Verification Incident Type | Minimum Severity | Escalation Requirement |
| --- | :---: | --- |
| Verification API completely unavailable | SEV1 | Full escalation per timing above |
| Verification results consistently incorrect | SEV1 | Immediate security lead involvement |
| Verification processing delayed >5 minutes | SEV2 | Notify engineering lead |
| Individual verification failures (isolated) | SEV3 | Log and monitor trend |
| Certificate rendering broken | SEV2 | Frontend lead involvement |
| Public verification links returning 404/500 | SEV2 | Immediate response required |

---

## 6. Post-Incident Review

- Within **2 business days** of recovery: assign follow-up owners
- Within **5 business days** of recovery: publish sanitized review
- Review must include: impact, timeline, detection, root cause, recovery, communication gaps, preventive actions with owners and deadlines
- Quarterly: review contacts and test primary-channel failure scenarios

---

## 7. Reference

- [`incident-command-checklist.md`](./incident-command-checklist.md) — detailed role assignments and decision tracking
- [`incident-communication.md`](./incident-communication.md) — communication templates and channel sequences
- [`SECURITY.md`](../../SECURITY.md) — private reporting and coordinated disclosure procedures