# 08 — Audit Event Vocabulary

Three record types, three purposes. **Do not** write the same fact to all three.

| Store | Purpose | Nature | Reader |
| --- | --- | --- | --- |
| **AuditLog** (existing) | System/security audit: who did what action, when, in which tenant. | Global, append-only, dot-namespaced `event`. | Auditors, security. |
| **IncidentTimelineEvent** (new) | Human-readable case narrative for reviewers/guardians. | Case-scoped, append-only. | Case participants (per scope). |
| **EvidenceCustodyEvent** (new) | Forensic chain-of-custody for a specific evidence object (integrity hashes). | Evidence-scoped, append-only, immutable. | Auditors, legal, sensitive-access holders. |

**Routing rule:** an action that is *security-relevant* → AuditLog; that is
*case-narrative-relevant* → Timeline; that *touches an evidence object's
integrity/access* → Custody. Many actions write to **two** (e.g. exporting
evidence: AuditLog `…exported` + Custody `exported`), but never redundantly to all
three without a distinct purpose.

## AuditLog events (dot-namespaced, append-only)
```
cyberbullying.protected_subject.created
cyberbullying.protected_subject.updated
cyberbullying.protected_subject.anonymized
cyberbullying.report.submitted
cyberbullying.detection.linked
cyberbullying.detection.unlinked
cyberbullying.incident.review_started        # → under_review
cyberbullying.incident.acknowledged
cyberbullying.incident.confirmed
cyberbullying.incident.dismissed             # requires reason
cyberbullying.incident.action_required
cyberbullying.incident.resolved              # requires resolution summary
cyberbullying.incident.archived
cyberbullying.incident.reopened              # requires reason + manage
cyberbullying.evidence.captured
cyberbullying.evidence.viewed_sensitive      # always audited
cyberbullying.evidence.redacted
cyberbullying.evidence.exported
cyberbullying.evidence.legal_hold_applied
cyberbullying.evidence.legal_hold_released
cyberbullying.guardian_authority.granted
cyberbullying.guardian_authority.revoked
cyberbullying.escalation.proposed
cyberbullying.escalation.approved
cyberbullying.escalation.sent
cyberbullying.escalation.failed
cyberbullying.protective_action.proposed
cyberbullying.protective_action.approved
cyberbullying.protective_action.completed
cyberbullying.protective_action.failed
cyberbullying.retention.policy_changed
cyberbullying.export.revoked
```
(Reuses the existing `security.detection.*` events for the detection lifecycle —
not re-created here.)

## IncidentTimelineEvent kinds (case narrative)
```
detection_linked · review_started · victim_contacted · guardian_notified ·
school_escalated · company_escalated · content_filtered ·
protective_recommendation_issued · trusted_contact_added · resolution_recorded
```

## EvidenceCustodyEvent kinds (forensic, immutable, integrity-hashed)
```
captured · uploaded · verified · viewed_sensitive · redacted · exported ·
transferred · retention_extended · legal_hold_applied · deleted · anonymized
```
Each custody event records: evidence ref · event type · actor · actor role ·
timestamp · reason · previous integrity hash · resulting integrity hash · export
reference · metadata.

## Separation invariants
- **AuditLog stays the technical/security audit** (never replaced by the
  Timeline). It never stores raw sensitive content — only ids/refs + metadata.
- **Timeline is the friendly case history** — references sensitive items by id,
  never by content.
- **Custody is the forensic ledger for evidence integrity** — the only place that
  chains integrity hashes; append-only and immutable.
