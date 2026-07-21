# 14 — Legal & Safeguarding Gate

An **explicit decision gate** that must be resolved before the corresponding data
flows are implemented. **C0 may complete without legal opinion. C1 MUST NOT
activate minor/guardian data flows without an approved gate.**

## Gate items (each requires a documented decision + owner + date before its flow ships)
| Gate item | Blocks | Decision needed |
| --- | --- | --- |
| **Minor flag** | Creating minor `ProtectedSubject` rows | Lawful basis for processing minors' data; per-jurisdiction differences; what may be stored (age category vs DOB). |
| **Guardian authority** | Guardian-scoped access | How guardian authority is verified; what result is stored (not documents); revocation. |
| **School access** | School reviewer scope | Basis for a school to process pupil data; org-unit scoping; notice. |
| **Company monitoring** | Company reviewer scope | Lawful basis + proportionality for employee data; transparency/notice; no covert monitoring. |
| **Sensitive evidence** | Storing/viewing sensitive evidence | Encryption/key management, size/type limits, sensitive-view audit, access roles. |
| **Sexual content** | Handling sexual/abuse material | Legal handling of potentially illegal content (esp. involving minors); reporting obligations; storage constraints. |
| **Emergency guidance** | Urgent-safety features | Explicit non-emergency-service disclaimer; recommend-contact-local-help wording; no automated authority contact. |
| **Retention** | Any retention beyond plan default | Per-type/per-case retention; legal hold; minor-specific rules. |
| **Deletion exceptions** | Legal-hold override of deletion | When deletion is deferred; minimal receipt; audit. |
| **Export** | Evidence export | Who approves; redaction profile; expiry; recipient obligations; cross-border. |

## Hard rules
- **Tamanor is not an emergency service.** It provides recommendations, does not
  determine legal guilt, does not auto-file criminal reports; on a credible
  imminent threat it **recommends** contacting local emergency help or a trusted
  person.
- **A minor's data flow is disabled** in code until the relevant gate item is
  approved (C1 criterion #9). The gate check itself is audited.
- **Sexual content involving minors** has special legal handling that may require
  restricting storage and following reporting obligations — resolve before any
  such evidence is accepted.
- **No covert monitoring, no device tracking, no unauthorized private-message
  access** — no gate can approve these; they are out of scope entirely.

## Automatic-action gate (which actions may be automatic vs require a human)
| Action | Reversible? | Who may execute |
| --- | --- | --- |
| Detect / rank / explain / recommend | n/a | AI/rules |
| Preserve evidence, hide/filter on an OWNED account (API-supported) | yes | reviewer/manage (approved) |
| Block contact (own platform) | yes | reviewer/manage |
| Report to platform | partial | reviewer/manage (approved) |
| Notify guardian / trusted contact | no (disclosure) | manage (approved) + authority verified |
| School/company escalation | no | manage (approved) |
| Legal/authority escalation | no | **human only, explicit** |
| Sanction / irreversible action | no | **never AI-only; human approval** |

## Gate output
For each item: **Decision · Basis · Owner · Date · Applies-to-sprint.** Until an
item is `Approved`, its flow stays disabled in code and its acceptance criterion
fails closed.
