# 07 — RLS Matrix

Contract only — **no SQL, no migration.** Every planned table follows the
existing Tamanor pattern: non-superuser `tamanor_app` runtime role, GUC
`app.tenant_id` set by `withTenant`, `tenant_isolation` policy `USING/WITH CHECK
("tenantId" = current_app_tenant_id())`, **ENABLE + FORCE**, no-context ⇒ 0 rows
(fail-closed), composite `(id, tenantId)` FKs for cross-table references.

> **Tenant RLS is necessary but not sufficient** for this domain. Subject-level
> access (guardian/reviewer/protected-user scoping) is an **additional
> application-layer scope filter** enforced server-side above RLS, because RLS
> isolates *tenants*, not *subjects within a tenant*.

## Planned tables (conceptual) × RLS contract
| Planned table | tenantId | ENABLE | FORCE | USING / WITH CHECK | Composite `(id,tenantId)` FK | Fail-closed (no ctx) | Extra subject-scope filter |
| --- | --- | --- | --- | --- | --- | --- | --- |
| protected_subjects | ✅ required | ✅ | ✅ | `"tenantId" = current_app_tenant_id()` | self `@@unique([id,tenantId])` | 0 rows | **yes** (own/guardian/reviewer scope) |
| protected_subject_relationships | ✅ | ✅ | ✅ | same | FK→protected_subject `(id,tenantId)` | 0 rows | **yes** (authority scope) |
| cyberbullying_incident_detail | ✅ | ✅ | ✅ | same | 1:1 FK→incidents `(id,tenantId)` | 0 rows | **yes** (case scope) |
| incident_participants | ✅ | ✅ | ✅ | same | FK→incidents `(id,tenantId)` | 0 rows | **yes** (case scope; redaction) |
| incident_detection_links | ✅ | ✅ | ✅ | same | FK→incidents & security_detections `(id,tenantId)` | 0 rows | case scope |
| incident_evidence | ✅ | ✅ | ✅ | same | FK→incidents `(id,tenantId)` | 0 rows | **yes** (+ sensitive gate) |
| evidence_context_items | ✅ | ✅ | ✅ | same | FK→incident_evidence `(id,tenantId)` | 0 rows | **yes** |
| evidence_custody_events | ✅ | ✅ | ✅ | same (append-only) | FK→incident_evidence `(id,tenantId)` | 0 rows | audit scope |
| incident_timeline_events | ✅ | ✅ | ✅ | same (append-only) | FK→incidents `(id,tenantId)` | 0 rows | case scope |
| protective_actions | ✅ | ✅ | ✅ | same | FK→incidents `(id,tenantId)` | 0 rows | case scope |
| consent_authority_records | ✅ | ✅ | ✅ | same | FK→protected_subject `(id,tenantId)` | 0 rows | **yes** (highly sensitive) |
| evidence_exports | ✅ | ✅ | ✅ | same | FK→incidents `(id,tenantId)` | 0 rows | **yes** (+ export perm) |

## Existing tables touched (RLS unchanged)
| Table | Change | RLS impact |
| --- | --- | --- |
| `incidents` | `brandId` → nullable (ADR-0001) | **None** — policy is on `tenantId`; nullable brandId does not affect isolation. |
| `security_detections` | future new subject type + kinds | **None** — already RLS FORCE; additive values only. |

## Enrolment rule
Each new tenant-scoped table MUST be added to the strict-table `tenant_isolation`
`DO`-loop (raw SQL migration, S0 pattern) and granted to `tamanor_app`; global
tables (none here) would instead be REVOKED from `tamanor_app`. Every new table is
tenant-scoped — there are **no** global tables in this domain.

## Verification obligation (for C1/C2, not C0)
For each table, prove: (A) tenant A cannot read/write tenant B rows; (B)
no-context ⇒ 0 rows and INSERT/UPDATE rejected (WITH CHECK); (C) the subject-scope
filter denies an in-tenant user who lacks authority over the subject; (D) sensitive
evidence requires `view_sensitive_evidence` **and** emits a custody event.
