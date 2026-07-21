# ADR-0003 — Detection ↔ Incident Boundary

**Status:** Accepted (C0 contract) · **Sprint:** C0

## Decision
Two distinct ledgers, one boundary:

- **`SecurityDetection` = the single ledger of security SIGNALS.** A detection is
  one observed, deterministic, tenant-scoped signal about a subject. It carries
  `kind`, `severity`, `confidence`, `source`, `reasonCode`, a **sanitized
  technical evidence summary**, `dedupeKey`, `occurrenceCount`, engine version,
  and its own lifecycle. Cyberbullying signals are a **future extension** of this
  same ledger (new subject type + new kinds + a detector adapter) — **not** a new
  ledger.
- **`Incident` = the single ledger of REVIEWED cases.** An incident is a
  human-owned case that may aggregate detections, evidence, participants, and
  timeline events, and drives protective actions.

## Rules

### When may an incident exist?
- From a **detection**: an authorized reviewer promotes/links one or more
  detections into an incident (incident opens at `open`).
- From a **manual report**: an incident may be opened **without any detection**
  (a victim/guardian/reviewer submits a report). This is expected and allowed.
  Detections may be linked later, or never.

### How do detections attach to an incident?
- Via an explicit **incident↔detection link** (conceptual `IncidentDetectionLink`;
  tenant-scoped, composite `(id, tenantId)` FK convention). The link records
  *which* detection, the *meaning* of the link, *added by*, *added when*.
- A detection may remain **open and standalone** without any incident. Linking is
  additive and reversible (unlink is audited); it never mutates the detection's
  own lifecycle.

### Dedupe rules
- **Detection-level dedupe** already exists and is authoritative for signals: the
  partial-unique index on `(tenantId, dedupeKey) WHERE status IN
  (open,acknowledged,confirmed)` guarantees at most one active detection per
  stable condition; recurrences bump `occurrenceCount` + `lastObservedAt`.
- **Incident-level dedupe** is a *review-time* concern, not a DB uniqueness
  constraint: the reviewer/opening logic should prefer linking a new detection to
  an existing **open** incident for the *same protected subject + category*
  rather than opening a duplicate case. This is a contract/heuristic, not an
  auto-merge; humans own case identity.

### Who may confirm an incident?
- Only a human with `cyberbullying:review`/`cyberbullying:manage` (brand:
  `incident:manage`). **No AI/rule may confirm an incident.** The system may
  detect, rank, explain, and recommend only.

### What must NOT be stored in `SecurityDetection.evidence`
`SecurityDetection.evidence` is a **sanitized technical summary only** (bounded,
secret-scrubbed key/value codes — as the S2 `sanitizeDetectionEvidence` enforces).
It must **never** contain:
- raw message text or full conversations,
- screenshots / binaries / attachments,
- personal identifiers (phone, address, email, minor identity),
- tokens, secrets, keys, session material, complete sensitive headers,
- doxxed data, sexual content, threat verbatim, or any forensic original.

All of the above belong to the **isolated evidence layer** (C2 contract): an
immutable evidence record + secure local StorageObject + custody ledger, keyed to
the **Incident**, never to the detection.

## Terminology invariant (applies to detections, incidents, UI, API, audit)
Use: *detected signal · suspected · alleged actor · under review · confirmed
after human review*. Never (without human confirmation): *confirmed attacker ·
perpetrator · guilty · proven attack*.

## Consequences
- Signals and cases scale independently; a noisy signal never becomes a “case” on
  its own.
- Sensitive/forensic data has exactly one home (the evidence layer), removing the
  temptation to inflate `SecurityDetection.evidence`.
- Manual reports are first-class (incident-without-detection), which is essential
  for victim-submitted evidence and for sources with no detector.
