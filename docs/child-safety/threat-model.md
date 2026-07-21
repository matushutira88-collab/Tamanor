# Tamanor Child Safety — Threat Model

> **Status: Accepted (CS-C0).** Enumerates the threats that bind every later Child
> Safety sprint. Each threat lists asset, attacker, attack path, impact, preventive +
> detective controls, residual risk, and the future sprint that owns the control.

## Guardian abuse

| Threat | Asset | Attacker | Attack path | Impact | Preventive control | Detective control | Residual risk | Owner |
|--------|-------|----------|-------------|--------|--------------------|-------------------|----------------|-------|
| Covert surveillance | Child's privacy | A parent | Uses product to secretly read messages | Trust/legal harm | Product is not a message reader; no content ingested (Charter, invariants 1–4) | Consent + audit trail | Low | CS-C1/C6 |
| Abusive guardian seeking info | Child safety | Violent guardian | Requests alerts to locate/harm child | Physical harm | Guardian is not auto a safe recipient; recipient safety evaluation | Suppressed-alert audit | Medium | CS-C8 |
| Custody conflict | Guardian authority | Conflicting guardians | One overrides the other while disputed | Wrong disclosure | `ConsentStatus.Disputed` blocks auto-override | Consent history | Medium | CS-C8/legal |
| Guardian impersonation | Guardian relationship | Impostor | Claims authorized-representative status | Unauthorized access | Guardian verification (`verifiedAt`, `NotVerified` eligibility) | Verification audit | Medium | CS-C7 |

## Platform / client abuse

| Threat | Asset | Attacker | Attack path | Impact | Preventive | Detective | Residual | Owner |
|--------|-------|----------|-------------|--------|------------|-----------|----------|-------|
| Compromised SDK runtime | Signal integrity | Malware | Forges/alters signals | False alerts | Signature + allowlist contract | Signature verify fail | Medium | CS-C6/C14 |
| Fake safety events | Signal stream | Attacker | Injects spoofed events | Alert fatigue / harm | Signature + nonce + rate limit | Anomaly detection | Medium | CS-C6 |
| Replay | Signal stream | Attacker | Re-sends captured events | Duplicate incidents | `nonce` anti-replay | Replay detection audit | Low | CS-C6 |
| Spoofed platform identity | Source trust | Attacker | Fakes `sourcePlatform` | Misattribution | Platform integration contract | Provenance audit | Medium | CS-C14 |
| Over-broad payload / raw content in unknown fields | Privacy | Client bug/attacker | Adds extra fields | Privacy breach | Strict allowlist rejects unknown + forbidden fields (CS-C0) | Gateway rejection log | Low | CS-C0/C6 |
| Event flooding | Availability | Attacker | Floods the gateway | DoS | Rate limiting + bounded batch | Flood metrics | Medium | CS-C6 |

## Account compromise

| Threat | Preventive | Detective | Owner |
|--------|------------|-----------|-------|
| Stolen guardian account | Existing session security (S2 ATO, device/session lifetime) | Session anomaly | CS-C7 |
| Session hijacking | HttpOnly opaque session, absolute expiry | Session audit | existing |
| Workspace-switch confusion | Switcher re-validates Membership; cache keys include workspace | — | CS-C0 |
| Cross-tenant cache leak | Tenant/workspace in query keys + RLS | RLS test | CS-C0 |

## Insider threat

| Threat | Preventive | Detective | Owner |
|--------|------------|-----------|-------|
| Business admin reads Family data | `WorkspaceKind` capability separation; separate Membership required | Access audit | CS-C0 |
| Support over-reach | Internal support access explicitly audited | `child_safety.*` audit | CS-C0/C10 |
| Expert org access without referral | Organization kind has no implicit Family data access | Referral audit | CS-C10 |

## Classification harm

False positive / false negative / mislabelling a person / dangerous guardian reaction
/ disproportionate escalation. Controls: language policy (no verdicts), human review
required for critical actions, confidence bands, evaluation harness + metrics
(CS-C11), DPIA + abuse-prevention review (CS-C12). Residual risk: **inherent** —
mitigated, never eliminated; owned by CS-C11/C12.

## Evidence abuse

Automatic message capture / unauthorized export / excessive retention / identity
leakage. Controls: evidence mode separate from detection (ADR-CS-0009), explicit
evidence consent (CS-C9), C11/C12-style redaction + export authorization applied only
to authorized, redacted data — never auto-applied to Family data. Owner: CS-C9.
