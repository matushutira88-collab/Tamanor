# 06 — Permission Matrix

Extends the existing `Permission` enum + `ROLE_PERMISSIONS` (server-enforced via
`can()/assertCan()` + `requireDashboardCapability`). **No permission is enforced
by hiding UI alone.** Sensitive-evidence access is a **separate** permission and
is always audited (a `viewed_sensitive` custody event).

## Roles (domain)
| Role | Meaning |
| --- | --- |
| Protected user | The person under protection (may or may not be a Tamanor user). |
| Parent/Guardian | Verified authority for a specific protected subject. |
| School reviewer | Reviews cases belonging to the school/org unit. |
| Company reviewer | Reviews company cases / work context. |
| Tenant security admin | Manages policy, reviewer grants, retention, escalation config. |
| Platform analyst | Analyzes pseudonymized signals + detection quality only. |
| Read-only auditor | Reads audit/custody/decisions; cannot mutate. |

> These map onto existing tenant `Role`s **plus** subject-scoped grants
> (relationships/consent). A tenant `Role` alone is never sufficient for
> subject-level access — a subject-scope filter runs **above** RLS.

## Proposed permission vocabulary
`cyberbullying:view_own`, `cyberbullying:report`, `cyberbullying:review`,
`cyberbullying:manage`, `cyberbullying:escalate`,
`cyberbullying:view_sensitive_evidence`, `cyberbullying:export_evidence`,
`cyberbullying:manage_retention`, `cyberbullying:manage_guardian_access`,
`cyberbullying:audit`.

## Operation × permission × scope × sensitive-audit
| Operation | Role(s) | Permission | Tenant scope | Subject scope | Sensitive-access audit |
| --- | --- | --- | --- | --- | --- |
| View own case | Protected user | `view_own` | own tenant | **own subject only** | no (own data) |
| Submit report + upload | Protected user, Reporter, Guardian | `report` | own tenant | own/authorized subject | yes (evidence captured) |
| Review queue / open detail | School/Company reviewer, Sec admin | `review` | tenant | assigned org-unit/subject | on sensitive view only |
| Acknowledge/confirm/dismiss | reviewer, Sec admin | `review` (+`manage` for confirm→action) | tenant | assigned scope | on sensitive view |
| Manage case / lifecycle actions | Sec admin, case owner | `manage` | tenant | assigned scope | on sensitive view |
| Escalate (guardian/school/company/platform) | reviewer, Sec admin | `escalate` | tenant | assigned scope | yes (escalation package) |
| View sensitive evidence (unredacted) | reviewer/admin **with grant** | `view_sensitive_evidence` | tenant | assigned scope | **always** (`viewed_sensitive`) |
| Export evidence | Sec admin (+approver) | `export_evidence` | tenant | assigned scope | **always** (export event) |
| Manage retention / legal hold | Sec admin | `manage_retention` | tenant | — | yes |
| Manage guardian access | Sec admin | `manage_guardian_access` | tenant | subject | yes |
| Guardian view of ward's case | Guardian | `view_own`-equivalent via authority | tenant | **verified ward only** | on sensitive view |
| Analyze pseudonymized signals | Platform analyst | (analyst scope) | tenant, **pseudonymized** | none (no identity) | n/a (no identity access) |
| Read audit/custody | Read-only auditor | `audit` | tenant | redacted per audit scope | reads only |

## Access rules (hard)
- **Protected user** sees: own cases, plain-language risk explanation, own
  uploaded evidence, recommended protective steps, appropriate case status.
  **Does not** see: internal reviewer notes, other minors' identities, sensitive
  technical metadata, retaliation-increasing info.
- **Guardian** sees only the **verified ward's** cases; scope may depend on the
  ward's age, legal basis, safety risk, and org policy. **No** automatic access to
  all of a minor's private communication.
- **School/Company reviewer** sees only cases in their org unit / work context,
  redacted per role; not personal cases outside that context.
- **Tenant security admin** manages config but does **not** get automatic
  unrestricted sensitive-evidence access — that needs `view_sensitive_evidence`.
- **Platform analyst** works on pseudonymized signals/metrics only — never victim
  identity or full evidence.
- **Read-only auditor** cannot mutate incidents or run protective actions.

## Enforcement contract
- Every sensitive operation is checked **server-side** (`assertCan`) **and**
  passes a **subject-scope filter** above RLS (tenant isolation is necessary but
  not sufficient for subject-level access).
- Every `view_sensitive_evidence` and `export_evidence` writes an
  `EvidenceCustodyEvent` (`viewed_sensitive`/`exported`) with actor, role, reason.
