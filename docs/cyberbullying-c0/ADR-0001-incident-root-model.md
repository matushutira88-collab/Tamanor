# ADR-0001 — Incident Root Model

**Status:** Accepted (C0 contract) · **Sprint:** C0 · **Date basis:** HEAD `972a239`

## Context — current state of `Incident`
The DB `Incident` model today (verified):
- `id`, `tenantId`, **`brandId String` (REQUIRED)**, `title`, `category String`,
  `severity String @default("medium")`, `status String @default("open")`
  (values `open|resolved`), `sourcePlatform String?`, `relatedItemIds String[]`
  (denormalized), `createdAt`, `resolvedAt?`.
- Relations: required `tenant` (Cascade), `relatedItems IncidentRelatedItem[]`
  (referentially-integral join to reputation items).
- `@@unique([id, tenantId])`, `@@index([tenantId, brandId, status])`, RLS FORCE
  (in the S0 strict-table `tenant_isolation` loop).

`IncidentRelatedItem` links an incident to reputation items via composite
`(childId, tenantId) → (id, tenantId)` FKs.

## Problem
A cyberbullying incident is **victim-centric** and frequently has **no brand**
(a pupil harassed on an account the tenant does not own; a user-submitted
report). But `Incident.brandId` is **required** and the model is brand-scoped
(`@@index([tenantId, brandId, status])`). We must let a single `Incident` ledger
carry non-brand cases **without** creating a second root ledger and **without**
degrading existing brand incidents.

## Options considered
### A. Make `Incident.brandId` nullable
- **+** Backward-compatible widening (no data change; existing rows keep their
  brandId). Cheapest migration (later, not in C0). Keeps one ledger.
- **+** Existing brand queries/filters still work; the composite `(id,tenantId)`
  unique and tenant Cascade are unaffected; the `(tenantId, brandId, status)`
  index tolerates NULLs.
- **−** On its own it does not hold cyberbullying-specific fields; risks brand
  incidents accidentally created without a brand if not constrained by category.
- **−** Introduces a nullable column that must be governed by an invariant.

### B. Keep `Incident` and add a one-to-one domain detail
- A tenant-scoped **one-to-one** detail (keyed uniquely by the incident) holds
  cyberbullying-specific fields (protected-subject link, urgency, case owner,
  retention/legal-hold, restricted-access flag, resolution/dismissal reason).
- **+** Isolates victim data from the shared root; no nullable sprawl on
  `Incident`; brand incidents are untouched (no detail row).
- **+** Extensible to future security domains (each gets its own detail).
- **−** Requires a join for domain views; needs a discriminator to know which
  detail exists.
- **−** Alone it does **not** solve the required-`brandId` problem (a cyberbullying
  incident still needs *some* brandId unless brandId is relaxed).

### C. Generalize `Incident` with a polymorphic subject/domain type
- Add `subjectType`/`domain` + many nullable columns for each domain on `Incident`.
- **+** Single table, single lifecycle.
- **−** **Nullable polymorphic sprawl** — the brief explicitly warns against this.
  Every new domain widens the root with mostly-null columns; weak typing; poor
  index locality; high accidental-coupling risk. **Rejected.**

## Decision
**Adopt B, enabled by A.** Concretely (as a contract; no schema in C0):
1. `Incident` remains the **single root ledger** of reviewed cases.
2. `Incident.brandId` becomes **nullable** (backward-compatible). Invariant:
   *brandId is present for brand/reputation categories and absent for
   victim-centric cyberbullying categories* — enforced by application logic keyed
   on `Incident.category` (the existing discriminator), not by a new enum column.
3. A **one-to-one cyberbullying detail** (tenant-scoped, `incidentId` unique,
   composite `(id, tenantId)` FK to the incident) carries victim-specific fields.
   It is a **detail of** the root, never a second root.
4. **Rejected:** any `CyberbullyingIncident`/`CyberbullyingCase` root ledger, and
   the pure-polymorphic option C.

## Consequences
- **Backward compatibility:** widening `brandId` to nullable does not alter
  existing rows or brand queries; the Brand relation becomes optional. Existing
  RLS, composite `(id,tenantId)` unique, tenant Cascade, and
  `IncidentRelatedItem` links are unaffected.
- **Migration risk (future, not C0):** low — one `ALTER COLUMN ... DROP NOT NULL`
  plus one additive detail table + its RLS enrolment (raw SQL, S0 pattern). No
  backfill required. The detail table follows the composite `(id, tenantId)` FK
  convention so cross-tenant references are structurally impossible.
- **Query complexity:** domain views join `Incident + detail`; list/overview
  queries filter by `category`. Acceptable; mirrors existing repo patterns.
- **RLS:** the detail table is tenant-scoped and MUST be added to the strict-table
  `tenant_isolation` FORCE loop; the one-to-one link inherits tenant isolation.
- **Future domains:** the detail-per-domain pattern generalizes without touching
  the root — this is the anti-sprawl property option C lacked.
- **Guardrail:** the nullable `brandId` must be governed by the category
  invariant and covered by a test in C1+, or it risks silent brand-less brand
  incidents.

## Explicit rejection
A parallel cyberbullying incident ledger with its own independent lifecycle is
**rejected** — it would create a second source of truth, a third lifecycle, and
duplicate the review/audit/RLS machinery. All reviewed cases live in `Incident`.
