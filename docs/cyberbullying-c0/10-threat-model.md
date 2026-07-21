# 10 — Threat Model

Format: **asset · threat · impact · mitigation · residual risk.** Mitigations are
contracts for C1+ (not implemented in C0).

| # | Asset | Threat | Impact | Mitigation (contract) | Residual |
| --- | --- | --- | --- | --- | --- |
| 1 | All tenant data | Cross-tenant access | Catastrophic privacy breach | Postgres RLS ENABLE+FORCE, `withTenant`, composite `(id,tenantId)` FKs, fail-closed no-context; RLS tests per table | Low (proven pattern) |
| 2 | Minor/ward data | Unauthorized guardian access | Serious safeguarding breach | Verified `ProtectedSubjectRelationship` + `ConsentAndAuthorityRecord`; subject-scope filter above RLS; guardian sees only verified ward | Medium (verification quality) |
| 3 | Sensitive evidence | Malicious/curious reviewer | Privacy harm, retaliation | `view_sensitive_evidence` separate perm; default redaction; every sensitive view = custody `viewed_sensitive` with reason; least-privilege | Medium (insider) |
| 4 | Evidence integrity | Evidence tampering | Loss of forensic value | Immutable originals; content hash + algorithm; append-only custody chain with prev/next hash; derived versions separate | Low–Medium |
| 5 | Uploaded evidence | Screenshot fabrication | False accusation | Never assert authenticity; “user-submitted, unverified”; alleged-actor language; human review; no auto-action from screenshot | Medium (inherent) |
| 6 | Logs/telemetry | Accidental sensitive logging | Data leak via logs | Classification policy: never log content/identifiers/tokens; ids+hashes only; log linter/review | Medium |
| 7 | Export package | Export leakage | Off-platform breach | `EvidenceExport` only: approval, redaction profile, expiry, download count, revoke, audited; short-lived | Medium |
| 8 | Personal data | Excessive retention | Legal/privacy breach | Per-case/type retention + legal hold; expiry → delete/anonymize + receipt + audit | Medium |
| 9 | Alleged actor identity | Incorrect identity linking | Wrongful accusation | Identity-linkage confidence; pseudonym default; human confirmation for cross-account linking; “alleged” everywhere | Medium |
| 10 | Case correctness | False-positive accusation | Harm to accused; distrust | AI detects/ranks/explains only; no AI confirmation; mandatory human review; explainable factors | Medium |
| 11 | Reporting system | Coordinated abuse of reporting (weaponized reports) | Harassment via false reports; reviewer overload | Rate/abuse controls on `report`; reporter recorded; dedupe; reviewer triage; audit of reporters | Medium |
| 12 | Storage | Malware upload | Compromise, distribution of illegal content | AV scan boundary before storage (C2 contract); type/size limits; quarantine; no inline execution | Medium |
| 13 | Repo/state | Concurrent writers (observed earlier) | Torn/inconsistent state, lost edits | Single-writer discipline; verified clean tree pre-work; backup branch; one auditable commit | Low (process) |
| 14 | Tenant control plane | Compromised tenant admin | Broad internal access | Admin ≠ automatic sensitive-evidence access; sensitive/export are separate audited perms; MFA (future) | Medium |
| 15 | AI pipeline | Prompt injection via evidence content | Manipulated classification/summaries | Treat evidence as untrusted DATA (existing OpenAI hardening pattern); no tool/action from model; structured output; human review | Medium |

## Cross-cutting invariants
- **Fail closed:** on uncertainty (missing context, unverified authority, unknown
  integrity) → deny/redact/surface for human review, never expose or auto-act.
- **No secret monitoring / no device tracking / no unauthorized private-message
  access** — prohibited regardless of technical feasibility.
- **No AI-only consequential action** — confirmation, accusation, sanction,
  legal/authority contact, and sensitive disclosure require a human.
