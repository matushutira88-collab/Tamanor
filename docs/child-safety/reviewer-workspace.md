# Child Safety Reviewer Workspace V1

The first operational interface for **authorized reviewers** to investigate the canonical child-safety
incidents produced by the protective-intervention backend (CS-C15A/B/C).

> This is an **operational layer on top of** the accepted canonical incident domain. It adds **no**
> detection, decision, or intervention behavior, and changes **no** accepted migration. It only reads the
> canonical records and records the human review lifecycle. **A `SafetySignal` is content-free by
> construction — raw message content never exists here, is never stored, logged, audited, or returned.**

## Architecture

```
Authorized reviewer (Owner / Administrator / Safety Reviewer)
  → web API routes  /api/v1/child-safety/reviewer/*        (thin; session + permission + same-origin)
    → apps/web/src/server/child-safety/reviewer.ts         (maps session → actor, errors → safe codes)
      → @guardora/db  child-safety-reviewer.ts             (SYSTEM-scoped service, systemDb)
        → canonical incident domain  (child_safety_incidents / _incident_signals / _escalations)
        + reviewer tables  (child_safety_reviewer_notes / child_safety_review_events)
        + shared audit log, notifications, safety_signal_deliveries, intervention ledger
```

The incident domain tables are **SYSTEM** tables (owner-role `systemDb`; all privileges `REVOKE`d from the
RLS app role `tamanor_app`). Tenant isolation is therefore enforced by **explicit `tenantId` scoping on
every query** plus composite `(id, tenantId)` foreign keys — not by RLS. The two new reviewer tables
(`child_safety_reviewer_notes`, `child_safety_review_events`) follow the same pattern.

## New tables (forward-only migration `20260816090000_cs_reviewer_workspace`)

| Table | Purpose | Immutability |
|---|---|---|
| `child_safety_reviewer_notes` | append-only internal reviewer notes (confidential body) | no update/delete path |
| `child_safety_review_events` | append-only reviewer-activity events (assign/status/note-marker/reopen) | no update/delete path |

Both are SYSTEM tables (`REVOKE ALL … FROM tamanor_app`), have a composite `(id, tenantId)` FK to
`child_safety_incidents` (cross-tenant linking is impossible at the DB level), and store no raw content
beyond the reviewer's own confidential note body (which is never logged, audited, or put on the timeline).
The migration also adds two additive read indexes to the existing incident table — no structure change.

## API

All endpoints are **Owner / Administrator / Safety Reviewer only** (session + permission enforced). Reads
require the `child_safety:review_view` permission; mutations require `child_safety:review_manage` **and**
same-origin (CSRF). Cross-tenant access returns `404` (never reveals existence in another tenant).

| Method & path | Purpose |
|---|---|
| `GET  /api/v1/child-safety/reviewer/incidents` | paginated, sorted, filtered incident list |
| `GET  /api/v1/child-safety/reviewer/incidents/{id}` | full incident detail (below) |
| `POST /api/v1/child-safety/reviewer/incidents/{id}/actions` | review action `{action, …}` |
| `GET  /api/v1/child-safety/reviewer/dashboard` | operational summary |

### List — sort / filter / search

- **Sort**: `newest`, `oldest`, `highest_severity`, `highest_urgency`. Newest/oldest paginate efficiently
  at any scale; the ranked sorts operate over the most-recent `MATCH_CAP` (2000) matches — a documented V1
  bound.
- **Filters**: `profileId`, `severity`, `urgency`, `escalationState`, `status` (exact), `createdFrom/To`,
  `updatedFrom/To`, and a coarse `filter` bucket (`open` / `escalated` / `resolved` / `dismissed` / `all`).
- **Search**: exact `search` match on **incident id** or **protected profile id** only — never a content
  search.
- **Pagination**: `page` + `pageSize` (default 25, hard max 100) with a real `total` and `hasMore`.

### Detail

Returns the incident, its **linked safety signals** (type / coarse severity / confidence band / review
status — never content), **escalations**, **internal notifications**, **guardian delivery status**
(aggregate by status/channel), **recovery status**, **audit references**, the **execution ledger summary**
(per-signal execution state — explicitly *not* the incident record), the append-only **reviewer notes**,
and the deterministic **timeline**. Detector payloads and raw content are never included.

## Permissions

`child_safety:review_view` and `child_safety:review_manage` are granted to **Owner** (via `OWNER_ALL`),
**Administrator**, and **Safety Reviewer** (`Role.reviewer`). Analyst and Viewer have neither. There is
**no public, guardian, SDK, or gateway path** to any reviewer function. Both permissions are additive
read/operational capabilities — they grant no platform mutation and no access to raw content.

## Timeline model

The timeline is generated **deterministically** from canonical records + reviewer events + the audit log
(no stored ordering). Entry kinds, in canonical tie-break order:

`incident_created` → `signal_linked` → `severity_increased` → `urgency_increased` →
`escalation_triggered` → `notification_sent` → `guardian_delivery` → `recovery_repair` →
`reviewer_assigned` → `reviewer_unassigned` → `status_changed` → `reviewer_note`.

- **Sources** — incident: `openedAt`; signal links: `linkedAt`; severity/urgency increases: derived by
  walking linked signals in `(linkedAt, id)` order and emitting an event whenever the running monotonic max
  rises (from `SafetySignal.severity` only — never content); escalations: `triggeredAt`; notifications:
  matched by `cs_escalation:{escalationId}` dedupe key; guardian deliveries: `safety_signal_deliveries`;
  recovery repairs: `child_safety.intervention.ledger_repaired` audit events; reviewer activity:
  `child_safety_review_events`.
- **Determinism** — every entry sorts by `(timestamp, type-priority, stable id)`, so the same inputs always
  produce byte-identical output (asserted in tests).
- **Content-free** — a `reviewer_note` entry carries only the opaque **note id**, author, and timestamp;
  the note **body** appears only in the detail `notes` array, never on the timeline or in audit.

## Review lifecycle

Reviewers act through four append-only, audited, tenant-isolated, permission-checked operations:

- **Assign / Unassign** — sets `assignedReviewerId`, records an `assigned`/`unassigned` review event.
- **Add note** — append-only; body is confidential (plain/markdown, ≤ 4000 chars); **editing and deletion
  are prohibited** (no update/delete path exists). A content-free `note_added` marker is added to the
  timeline.
- **Set status** — the state machine over `ChildSafetyReviewStatus`:

| From | Allowed → |
|---|---|
| open / under_review / waiting / reopened / action_required / monitoring | `under_review`, `waiting`, `resolved`, `dismissed` |
| resolved / dismissed / closed (terminal) | `reopened` only |
| reopened | back to any live target |

Same → same is rejected (every persisted event is a real change). `resolved`/`dismissed` set `closedAt`
and a `resolutionCode`; `reopened` clears `closedAt`. Every transition is recorded as a review event and a
content-free audit entry.

Because `dismissed` (like `resolved`/`closed`) is **terminal**, a dismissed incident is never reused for
automatic signal correlation — a later same-family signal opens a fresh incident. Machine-created incidents
are only ever `open`, so the accepted CS-C15 correlation/intervention behavior is unchanged.

## Dashboard summary

All metrics are computed from canonical tables: open incidents, escalated, critical (open + critical),
resolved today (`closedAt ≥ start of UTC day`), **average response time** (first reviewer pickup −
`openedAt`), **average resolution time** (`closedAt − openedAt`), signals last 24h, guardian deliveries
(last 24h + total), and the top-5 risk families.

## Security & privacy invariants

- Owner / Administrator / Safety Reviewer only; no public / guardian / SDK / gateway access.
- Every query is explicitly `tenantId`-scoped; cross-tenant reads/writes return `404`. Composite
  `(id, tenantId)` FKs make cross-tenant linking impossible at the DB level.
- All review actions are **append-only** and **audit-logged** (human actor, content-free metadata).
- No raw content, detector payload, transcript, or classifier score is ever stored or returned; a note
  body never leaves the detail/notes read path (never logged, audited, or put on the timeline).
- Web responses are stable, non-leaky codes — no Prisma / stack / cross-tenant existence.

## Known limitations

- The ranked (severity/urgency) list sorts operate over the most-recent 2000 matching incidents per query.
- Fine-grained severity/urgency-increase timeline events are **derived** from linked-signal severities
  (the accepted backend does not emit a per-change audit event); they are deterministic but reconstructed.
- Review is driven synchronously by the API; there is no background worker, no reviewer UI pages (this
  sprint delivers the API + service layer), and no external reporting.
- **Tamanor reduces risk and speeds intervention but cannot guarantee 100% protection.**
