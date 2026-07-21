# ADR-CS-0006 — Guardian is not automatically a safe recipient

**Status: Accepted (CS-C0).**

## Context
In some cases the guardian is the source of risk (abuse, family violence, contested
custody). Auto-alerting every guardian could endanger the child.

## Decision
A guardian relationship does **not** imply a safe alert recipient. Every alert
candidate passes a **recipient safety evaluation** (`SafetyRecipientEligibility`)
before any guardian alert. Alerts are suppressed / routed to expert review when the
guardian is a potential risk source, unverified, suspended, conflicted, or when policy
requires review. **No automatic decision in CS-C0.**

## Alternatives considered
- Alert all guardians automatically (rejected: unsafe).

## Consequences
`SafetyIncident → AlertCandidate → RecipientSafetyEvaluation → GuardianAlert /
ExpertReview / SuppressedAlert` (CS-C8).

## Security implications
Prevents guardian-abuse escalation paths.

## Migration impact
None (concept only in CS-C0).
