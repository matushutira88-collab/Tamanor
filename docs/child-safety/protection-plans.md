# Child Safety Protection Plans V1

A structured, **internal** protection-plan layer on top of the canonical `ChildSafetyIncident`. It lets an
authorized child-safety reviewer define, assign, track, complete, reopen, and audit concrete protective
**actions** for an incident. It is deliberately narrow — an internal coordination tool, **not** a generic
project- or case-management platform, and **not** a workflow engine.

> **Limitations (read first).** Recommendations are advisory and **do not replace professional judgment**.
> There is **no automatic police/legal/medical reporting**, no automatic external contact, and no automatic
> account restriction outside the existing authorized systems. Tamanor reduces risk and speeds intervention
> but **cannot guarantee 100% protection**. V1 is an internal coordination tool only.

## Domain models

Three canonical **SYSTEM** tables (owner-role `systemDb`; all privileges `REVOKE`d from `tamanor_app`),
composite `(id, tenantId)` FKs so cross-tenant linking is impossible:

| Model | Purpose |
|---|---|
| `ChildSafetyProtectionPlan` | one protective plan per incident (≤1 non-terminal at a time) |
| `ChildSafetyProtectionAction` | a concrete protective action within a plan (unique `sequence`) |
| `ChildSafetyProtectionActionEvent` | append-only plan/action event log (deterministic timeline source) |

`ChildSafetyProtectionPlan`: id, tenantId, incidentId, status, priority, createdBy, activatedAt, completedAt,
closedReason (bounded code), **revision** (optimistic-concurrency marker), createdAt.
`ChildSafetyProtectionAction`: id, tenantId, planId, actionType, title, description, priority, status,
assignedReviewerId, dueAt, completedAt, completedBy, **completionNote**, **blockReason**, sequence, createdBy.
`completionNote` + `blockReason` are **internal protected free text** — stored only on the action row.

## Action catalog

A bounded, typed, localized, **not user-extensible** catalog: `review_account_safety`, `preserve_evidence`,
`verify_guardian_contact`, `notify_authorized_guardian`, `restrict_interaction`, `recommend_blocking`,
`recommend_reporting`, `escalate_internal_safety`, `legal_review`, `welfare_check`, `follow_up_review`,
`custom_internal_action`. Each template defines a default title/description (i18n keys), a default priority,
and advisory flags (`guardianRelevant`, `evidenceRecommended`, `escalationRecommended`). **Templates are
recommendations only** — they never autonomously execute anything and are never presented as legal/medical
advice.

## Recommendation rules

`recommendProtectionPlan(input)` is **deterministic** (no LLM, no external API, no clock): the same canonical
input always yields the same recommendation. Inputs: risk family, severity, urgency, escalation state,
guardian-delivery state, evidence count, incident status. It produces a de-duplicated, ordered action set
(baseline + per-risk-family set + state-driven additions), a plan priority, per-action due windows, and
bounded explanation codes (`no_evidence_captured`, `guardian_not_notified`, `urgent_risk`, …). Output is
content-free. The reviewer must explicitly approve/activate — nothing is created until they do.

## Lifecycle state machines

**Plan:** `draft → active`; `active → completed | cancelled`; `completed | cancelled → reopened (→ active)`.
Same→same and any other transition fail closed. Completion is **fail-closed**: a plan may complete only when
**every** action is resolved (completed or explicitly skipped). Reopening clears `completedAt`/`closedReason`
but **preserves history** — the `plan_completed` event remains in the append-only log.

**Action:** `pending → in_progress`; `{pending, in_progress} → blocked`;
`{pending, in_progress, blocked} → completed | skipped`; `{completed, skipped} → reopened`. Invalid/no-op
transitions fail closed.

## Permissions

`child_safety:protection_plan_view` / `child_safety:protection_plan_manage`, granted only to **Owner /
Administrator / Safety Reviewer**. Analyst and Viewer are denied. Every operation is permission-checked at the
server boundary (hidden UI is never the enforcement); mutations require same-origin (CSRF); cross-tenant
access returns 404; no guardian / SDK / gateway / public access.

## APIs

Thin authenticated routes under the reviewer namespace:

- `GET  /api/v1/child-safety/reviewer/incidents/{id}/protection-plan` — current plan + progress + timeline, or the recommendation preview if none.
- `POST /api/v1/child-safety/reviewer/incidents/{id}/protection-plan` — `{op: create|activate|complete|cancel|reopen}`.
- `POST /api/v1/child-safety/reviewer/incidents/{id}/protection-plan/actions` — add a bounded custom action.
- `POST /api/v1/child-safety/reviewer/incidents/{id}/protection-plan/actions/{actionId}` — `{op: assign|unassign|due|priority|start|block|complete|skip|reopen}`.

The UI uses server actions (same convention) for mutations; the routes exist for programmatic use.

## UI behavior

A **Protection plan** tab on the incident detail page, with four states: **no plan** (recommendation preview
+ explanation + create draft), **draft** (add bounded custom actions + activate/cancel), **active/reopened**
(progress bar + action checklist with assign/due/priority + start/block/complete/skip/reopen, add action,
complete/cancel plan, timeline), and **terminal** (read-only history + reopen). Professional, responsive,
dark-mode, keyboard-accessible, EN/SK/DE localized; terminal plan ops use accessible confirmation dialogs
(no `window.confirm`); no unsafe HTML; safe error codes only. Actions revalidate the incident detail, plan
progress, and the reviewer dashboard.

## Progress calculation

`computePlanProgress` returns total / pending / in-progress / blocked / completed / skipped / overdue and
**completionPct = round(100 × completed / (total − skipped))** — skipped actions are **excluded from the
denominator** (deliberately not-applicable) and are **never** counted as completed. An empty or all-skipped
plan is 100% (nothing left to do). `overdue` = a due, unresolved action past now.

## Timeline

Deterministic, derived from the append-only `ChildSafetyProtectionActionEvent` log, sorted by
`(timestamp, stable event priority, stable id)`. Descriptions are content-minimized (bounded event/status/
priority codes + opaque ids). It never contains a completion note or block reason.

## Audit & privacy

Every mutation appends a content-free audit entry (tenant-safe refs + event/action type + actor + timestamp +
safe status/priority codes) via the existing audit system, and a canonical action event. **Completion notes
and block reasons are never copied into events, audit, or notifications** — they live only on the action row
and are returned only through the authorized plan read path.

## Concurrency guarantees

- **One non-terminal plan per incident** — a per-incident advisory lock in `createDraft`/`reopen` **plus** a
  partial `UNIQUE (incidentId) WHERE status IN (draft, active, reopened)` index. Concurrent creation converges
  to exactly one plan.
- **Gap-free unique action sequence** — a per-plan advisory lock allocates `max(sequence)+1`, backed by
  `UNIQUE (planId, sequence)`. Concurrent adds converge to 1..n.
- **Conflict-free transitions** — status changes use a guarded conditional update (`updateMany WHERE status
  IN allowed`); only one concurrent transition from a valid prior state can win (no double-complete / lost
  update). Plan transitions additionally guard on `revision` (optimistic concurrency).

## Dashboard integration

The reviewer dashboard gains five narrow plan metrics (incidents without an active plan, active plans, overdue
actions, blocked actions, plans completed today). Existing metrics are unchanged (backward compatible).

## Known limitations

- Recommendations are advisory and do not replace professional judgment.
- No automatic police / legal / medical reporting, external contact, or account restriction.
- The catalog is fixed in V1 (custom actions are free-form internal titles, not new catalog types).
- Due windows are simple priority-based defaults; there is no SLA engine.
- V1 is an internal coordination tool, not a generic case-management platform.
- Tamanor cannot guarantee 100% protection.
