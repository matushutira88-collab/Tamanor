# 12 — C1 Acceptance Criteria — Protected Subject & Access Foundation

**Sprint C1 goal:** stand up the isolated identity/authority foundation
(`ProtectedSubject`, relationships, permissions, RLS, audit) with **no evidence
upload and no minor/guardian data flow** until the legal/safeguarding gate (C14)
is approved.

## In scope (C1)
- `ProtectedSubject` (tenant-scoped) + `ProtectedSubjectRelationship` +
  (structure only) `ConsentAndAuthorityRecord`.
- New `cyberbullying:*` permissions added to `Permission` + `ROLE_PERMISSIONS`.
- Subject-scope access filter above tenant RLS.
- Audit events for subject/authority lifecycle.
- `Incident.brandId` made nullable (ADR-0001) — additive, backward-compatible.

## Explicitly OUT (C1)
- Evidence upload / storage / any binary (that is C2).
- **Any minor or guardian data flow** unless the C14 gate is approved.
- Detectors, UI beyond minimal management, escalation, notifications, exports.

## Acceptance criteria
1. **Protected subject basics:** a `ProtectedSubject` can be created/updated/
   anonymized within a tenant; supports pseudonym/reference + **age category**
   (not exact DOB where not required); `minor` flag exists but **minor rows are
   blocked from creation until C14 is approved** (gate check).
2. **Relationships:** a relationship (guardian/trusted/reviewer/case manager) can
   be recorded with scope, verification state, validity window, source — but a
   relationship granting access to a **minor** is blocked pre-C14.
3. **Permissions:** `cyberbullying:view_own/report/review/manage/escalate/
   view_sensitive_evidence/export_evidence/manage_retention/manage_guardian_access/
   audit` exist and map to roles; server-side `assertCan` enforced.
4. **RLS:** every new table is tenant-scoped, RLS **ENABLE+FORCE**, in the
   strict-table loop, granted to `tamanor_app`; no-context ⇒ 0 rows; INSERT/UPDATE
   for another tenant rejected (WITH CHECK).
5. **Subject scope:** an in-tenant user **without** authority over a subject is
   denied (proves tenant RLS alone is insufficient and the subject filter works).
6. **Audit:** subject/authority lifecycle events written via `writeAudit` inside
   the tenant transaction; no sensitive content in audit metadata.
7. **Tenant isolation tests:** cross-tenant read/write blocked for all new tables.
8. **No evidence upload:** no endpoint or model accepts binary/evidence content.
9. **No minor/guardian flow:** a hard gate prevents creating minor subjects or
   guardian-scoped access until C14 sign-off; the gate itself is audited.
10. **Backward compatibility:** existing brand incidents unaffected by nullable
    `brandId`; existing tests remain green; typecheck/lint/i18n/build pass;
    migrations applied **local-only** (DB safety guard blocks remote).

## Definition of done
All criteria met, RLS + subject-scope tests pass locally, no runtime regression,
one auditable commit, no push/deploy, C14 gate wired for minor/guardian.
