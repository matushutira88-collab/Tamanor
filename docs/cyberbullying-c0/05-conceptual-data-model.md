# 05 — Conceptual Data Model (C0)

**Conceptual only.** No Prisma syntax, no field lists as columns, no migration.
Each entity states: purpose · tenant scope · source of truth · key relations ·
personal/sensitive data · retention meaning · immutable vs mutable. Reuses
existing entities where noted; introduces isolated ones where the domain requires.

> Naming is provisional and must be reconciled with existing Prisma conventions
> at implementation time (not in C0).

## Reused (existing — extend, do not fork)
- **SecurityDetection** — source of truth for **signals** (incl. future
  cyberbullying signals). Mutable status; append-only in spirit. Sensitive data
  **excluded** from `evidence`. (ADR-0003.)
- **Incident** — source of truth for **reviewed cases** (brand + cyberbullying).
  `brandId` becomes nullable; cyberbullying detail attached one-to-one.
  (ADR-0001/0002.)
- **AuditLog** — global system audit (append-only). Not the case timeline nor the
  custody ledger.
- **Tenant / User / Membership / UserSession** — tenancy, identity, RBAC, sessions.

## New (isolated, tenant-scoped) — conceptual

### ProtectedSubject
- **Purpose:** the person under protection (pupil/employee/client/represented).
- **Tenant scope:** tenant-scoped (`tenantId`); subject-scope filter above RLS.
- **Source of truth:** for *who is protected* (NOT a user account by default).
- **Relations:** tenant; relationships; incidents (as target); participants.
- **Personal/sensitive:** **highly sensitive.** Prefer a pseudonym/reference +
  **age category** over exact DOB where exact DOB is not required; `minor` flag;
  vulnerability indicators stored only to the minimum necessary; consent/authority
  status. Sensitive attributes separated from routinely-displayed fields.
- **Retention:** governed by case retention + legal hold; anonymization/deletion
  dates tracked.
- **Mutability:** mutable (status/consent), with anonymization endpoint.

### ProtectedSubjectRelationship
- **Purpose:** authority link between a protected subject and an authorized person
  (guardian / trusted contact / school reviewer / company reviewer / case manager).
- **Tenant scope:** tenant-scoped; also subject-scoped.
- **Source of truth:** *who may act for/see this subject and in what scope*.
- **Relations:** protected subject; (optional) internal user; consent record.
- **Personal/sensitive:** sensitive (authority basis, verification state).
- **Retention:** tied to authority validity + case retention.
- **Mutability:** mutable (verification, start/end, revocation).

### CyberbullyingIncidentDetail (one-to-one detail of `Incident`)
- **Purpose:** cyberbullying-specific fields for a reviewed case, attached 1:1 to
  the root `Incident` (ADR-0001 option B).
- **Tenant scope:** tenant-scoped; composite `(id, tenantId)` FK to `Incident`.
- **Source of truth:** victim-domain detail (protected subject link, urgency, case
  owner, retention policy, legal hold, restricted-access flag, resolution/dismissal
  reasons). Lifecycle/severity live on the **root** `Incident` (single lifecycle).
- **Relations:** 1:1 `Incident`; protected subject; participants; evidence.
- **Personal/sensitive:** sensitive.
- **Retention:** carries the case retention policy + legal hold.
- **Mutability:** mutable (case fields).

### IncidentParticipant
- **Purpose:** a role a person plays in a case: `target`, **`alleged_source_actor`**,
  `witness`, `reporter`, `guardian`, `reviewer`, `trusted_contact`.
- **Tenant scope:** tenant-scoped; subject/case-scoped.
- **Source of truth:** *who is involved and how* (never asserts confirmed guilt).
- **Relations:** incident; (optional) protected subject; (optional) internal user.
- **Personal/sensitive:** sensitive. May hold a platform identifier, a
  pseudonymized identifier, a display label, an internal-user link, an
  **identity-linkage confidence**, and a redaction state.
- **Retention:** case retention.
- **Mutability:** mutable (role, redaction, identity confidence).

### IncidentDetectionLink
- **Purpose:** link an incident to one or more `SecurityDetection`s (ADR-0003).
- **Tenant scope:** tenant-scoped; composite `(id, tenantId)` FKs both sides.
- **Source of truth:** the *association* (not the signal, not the case).
- **Relations:** incident; detection; added-by; added-at; link meaning.
- **Sensitive:** low (association metadata only).
- **Retention:** with the incident.
- **Mutability:** append/remove (link/unlink audited); the row itself is immutable.

### IncidentEvidence
- **Purpose:** a forensic evidence record for a case. **Binary content is NOT in
  the DB** — a secure StorageObject reference is (C2).
- **Tenant scope:** tenant-scoped; subject/case-scoped.
- **Source of truth:** the *evidence record + integrity metadata* (type, source
  type, capture method, source platform, source locator/external id, original
  timestamp, captured timestamp, submitted-by, author/target references, storage
  object reference, redacted preview, content hash + algorithm, MIME, size,
  verification status, retention deadline, legal hold, deletion status).
- **Personal/sensitive:** highly sensitive.
- **Retention:** explicit deadline + legal hold.
- **Mutability:** **original is immutable**; derived (redacted/translated) versions
  are separate records linked to the parent.

### EvidenceContextItem
- **Purpose:** minimal before/after context around the primary evidence.
- **Tenant scope:** tenant-scoped; evidence-scoped.
- **Source of truth:** the *bounded* surrounding context (only what is needed).
- **Relations:** evidence (parent); sequence position; relation `before|primary|after`.
- **Sensitive:** sensitive (redacted text + origin reference + hash).
- **Retention:** with the evidence.
- **Mutability:** immutable once captured.

### EvidenceCustodyEvent
- **Purpose:** append-only forensic chain-of-custody for a specific evidence
  object (distinct from AuditLog and the case Timeline).
- **Tenant scope:** tenant-scoped; evidence-scoped.
- **Source of truth:** *what happened to this evidence* (captured, uploaded,
  verified, viewed_sensitive, redacted, exported, transferred, retention_extended,
  legal_hold_applied, deleted, anonymized) with actor, role, timestamp, reason,
  previous+resulting integrity hash, export reference, metadata.
- **Sensitive:** metadata (references hashes, not content).
- **Retention:** at least as long as the evidence + legal requirements.
- **Mutability:** **append-only, immutable.**

### IncidentTimelineEvent
- **Purpose:** human-readable chronology of the case (detection linked, review
  started, victim contacted, guardian notified, school/company escalated, content
  filtered, protective recommendation issued, trusted contact added, resolution
  recorded).
- **Tenant scope:** tenant-scoped; case-scoped.
- **Source of truth:** the *case narrative* (NOT a replacement for AuditLog or
  custody).
- **Sensitive:** internal (may reference sensitive items by id, not content).
- **Retention:** with the incident.
- **Mutability:** append-only.

### ProtectiveAction
- **Purpose:** a recommended or executed protective step (hide/filter content,
  preserve evidence, block contact, report to platform, contact trusted person,
  notify guardian, school/company escalation, urgent safety guidance, no action).
- **Tenant scope:** tenant-scoped; case-scoped.
- **Source of truth:** *what was proposed/approved/done*, its own lifecycle
  (`proposed → approved → executing → completed → failed → cancelled`), proposer,
  AI-vs-rule origin, approver, external result, reason, rollback capability.
- **Sensitive:** internal/sensitive depending on payload.
- **Retention:** with the incident.
- **Mutability:** status mutable; **irreversible/consequential actions require
  human approval — never AI-only.**

### ConsentAndAuthorityRecord
- **Purpose:** lawful-basis/consent for a minor or represented person.
- **Tenant scope:** tenant-scoped; subject-scoped.
- **Source of truth:** *the verification RESULT + granted scopes* — **not** a copy
  of identity documents (store the outcome, not the document).
- **Relations:** protected subject; relationship; verified-by; method; validity;
  revocation.
- **Personal/sensitive:** highly sensitive.
- **Retention:** legal-basis driven; minimal.
- **Mutability:** grant/revoke; the grant record is immutable, revocation appends.

### EvidenceExport
- **Purpose:** an audited, time-limited export package of case evidence.
- **Tenant scope:** tenant-scoped; case-scoped.
- **Source of truth:** *the export request + its constraints* (requested-by,
  approved-by, scope, redaction profile, generated timestamp, expiry, hash,
  download count, revoked timestamp).
- **Personal/sensitive:** highly sensitive.
- **Retention:** short-lived; expires; audited.
- **Mutability:** append-only lifecycle (generated → downloaded → revoked/expired).

## Relationship overview (conceptual)
```
Tenant
 ├─ ProtectedSubject ──* ProtectedSubjectRelationship ──(opt) User
 │        │
 │        └─ ConsentAndAuthorityRecord
 │
 ├─ Incident (root; brandId nullable) 1─1 CyberbullyingIncidentDetail ── ProtectedSubject
 │        ├─* IncidentParticipant
 │        ├─* IncidentDetectionLink ──* SecurityDetection   (signal ledger; standalone-capable)
 │        ├─* IncidentEvidence ──* EvidenceContextItem
 │        │        └─* EvidenceCustodyEvent   (append-only)
 │        ├─* IncidentTimelineEvent           (append-only)
 │        ├─* ProtectiveAction
 │        └─* EvidenceExport
 └─ AuditLog (global system audit; append-only)
```
