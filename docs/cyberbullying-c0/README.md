# Cyberbullying Protection — Sprint C0: Architecture Contracts

> **Status:** Contracts only. **No** runtime code, Prisma models, migrations, UI,
> API, detectors, storage, or data flows are created in C0. Documentation only.
> **Baseline:** branch `s2-account-takeover-foundation`, HEAD
> `972a2392eeab35a4efc727465b43d80438ca68e7`, clean tree.
> **Scope guard:** local R&D (`Desktop/Tamanor`) only — no Guardora, no remote,
> no push, no deploy, no production DB.

These documents fix the architecture boundaries **before** any Cyberbullying
Protection code is written, because the top risks are architectural (a parallel
incident ledger, overloaded evidence, mislabeling a person, unresolved
minor/guardian authority) — not implementation. Every decision here is grounded
in the **existing** Tamanor codebase (see the audit), and introduces **no**
parallel source of truth.

## Binding principles (from the sprint brief, restated as invariants)
1. `SecurityDetection` stays the **single** ledger of security signals. No
   `CyberbullyingDetection`.
2. `Incident` stays the **single** ledger of reviewed cases. No parallel
   `CyberbullyingIncident` root.
3. Exactly **one** canonical Incident lifecycle. Detection, Incident, and
   ProtectiveAction are three **distinct** lifecycles.
4. Victim-centric data stays **isolated** from brand-reputation data.
5. Sensitive evidence is **never** stored in `SecurityDetection.evidence` (that
   field remains a sanitized technical summary).
6. A signal is **never** presented as a confirmed incident. Vocabulary:
   *detected signal · suspected · alleged actor · under review · confirmed after
   human review*.
7. Consequential decisions stay **human-reviewable**. AI/rules may detect, rank,
   explain, recommend — never confirm an incident, accuse, sanction, contact
   authorities, escalate legally, or disclose sensitive evidence to an
   unauthorized person.

## Documents
| # | Document | Purpose |
| --- | --- | --- |
| ADR-0001 | [Incident Root Model](./ADR-0001-incident-root-model.md) | Resolve `Incident.brandId` required-vs-optional; reject a parallel ledger. |
| ADR-0002 | [Canonical Incident Lifecycle](./ADR-0002-canonical-incident-lifecycle.md) | One canonical lifecycle + transition matrix + reopen rules. |
| ADR-0003 | [Detection ↔ Incident Boundary](./ADR-0003-detection-incident-boundary.md) | Signal ledger vs case ledger; what may/may not be stored where. |
| 04 | [Cyberbullying Domain Boundary](./04-domain-boundary.md) | What belongs / does not belong in the module. |
| 05 | [Conceptual Data Model](./05-conceptual-data-model.md) | Conceptual entities (no Prisma, no migration). |
| 06 | [Permission Matrix](./06-permission-matrix.md) | Roles × operations × scope × sensitive-access audit. |
| 07 | [RLS Matrix](./07-rls-matrix.md) | Per planned table: tenantId, ENABLE/FORCE, USING/WITH CHECK, subject-scope. |
| 08 | [Audit Event Vocabulary](./08-audit-event-vocabulary.md) | Dot-namespaced events; AuditLog vs Timeline vs Custody. |
| 09 | [Data Classification Policy](./09-data-classification.md) | 5 levels + per-datum classification + handling rules. |
| 10 | [Threat Model](./10-threat-model.md) | Asset · threat · impact · mitigation · residual. |
| 11 | [Supported Source Contract](./11-supported-source-contract.md) | Per source: scope, permission, feasibility, legal, limits, auto-action. |
| 12 | [C1 Acceptance Criteria](./12-c1-acceptance-criteria.md) | Protected Subject & Access Foundation. |
| 13 | [C2 Acceptance Criteria](./13-c2-acceptance-criteria.md) | Evidence Foundation (local-only). |
| 14 | [Legal & Safeguarding Gate](./14-legal-safeguarding-gate.md) | Explicit decision gate before minor/guardian/evidence flows. |

## Decision summary (the load-bearing choices)
- **Incident root (ADR-0001):** make `Incident.brandId` **nullable** (backward-
  compatible widening) **and** attach a **one-to-one** cyberbullying domain
  detail keyed by the incident — i.e. **option B enabled by A**. Reject pure
  polymorphic option C; reject a parallel ledger. `Incident` stays the single
  root; `Incident.category` is the discriminator.
- **Canonical lifecycle (ADR-0002):** `open → under_review → acknowledged →
  confirmed → action_required → resolved → archived`, with `dismissed` as a
  terminal off-ramp and **reopen** as an explicit audited operation (never a raw
  back-transition). `detected` is a **Detection** state, not an Incident state.
- **Boundary (ADR-0003):** a `SecurityDetection` is a signal (can stand alone);
  an `Incident` is a reviewed case; an incident may be opened **from a detection
  or from a manual report** (no detection required); sensitive content lives only
  in the future isolated evidence layer.

## Cross-reference to code (verified facts this sprint depends on)
- `Incident.brandId` is currently **required** (`brandId String`, required Brand
  relation, `@@index([tenantId, brandId, status])`).
- `SecurityDetection` (S2) already carries `subjectType/subjectId`, `severity`,
  `confidence`, `dedupeKey`, `occurrenceCount`, `reasonCode`, sanitized
  `evidence`, `source`, lifecycle + partial-unique active-dedupe index; **RLS
  FORCE**.
- Core `IncidentLifecycleStatus` (`open/investigating/contained/resolved/
  post_mortem`) exists but is **unused** by the DB `Incident` (which is
  `open|resolved`). C0 reconciles these into one canonical lifecycle.
- **No** `StorageObject/Attachment/Blob/File` model exists — the evidence binary
  store is net-new (C2, local-only).
- **No** security notification/escalation delivery pipeline exists (only
  transactional email). Escalation delivery is a later sprint.
