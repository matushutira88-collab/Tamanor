# Family Notifications — Phase 3A: Durable Outbox & Delivery-Available Trigger

Phase 2b completed recipient RESOLUTION for all 13 Family notification types (authorization boundary). Phase 3A
adds the durable **event-delivery foundation** and wires the **first live trigger** — `family_delivery_available`
— without weakening any child-safety transaction. It ships no scheduler, no UI, and no delivery channels.

## Why an outbox (transactional guarantee)

The rows that a Family user finally sees (`notifications`) are written by the tenant-scoped, RLS-enforced app
role, while some sources (incidents, protection plans) live in owner-only tables and recipient authorization is
re-evaluated live. Creating the notification rows *synchronously inside the child-safety transaction* would force
a single transaction to span the app role, the owner role, and multiple live evaluators — brittle and, for
owner-only sources, impossible.

Instead we split it:

```
   ┌─ canonical domain transaction (app role, RLS) ─┐
   │  delivery → available                          │   ONE atomic commit
   │  + enqueue ONE bounded outbox event            │
   └────────────────────────────────────────────────┘
                     │  (commit)
                     ▼
   trusted processor (owner, later, retryable)
     claim → re-evaluate CURRENT authorization → createAuthorizedFamilyNotification → mark completed
```

**`rollback_required` means:** the outbox event is inserted in the SAME transaction as the domain transition. If
the enqueue cannot be durably inserted, the transition to `available` rolls back. It does **not** require the
final notification row to be created synchronously. After commit, the processor creates rows asynchronously and
retries safely (at-least-once event processing, exactly-once observable notification rows via dedupe).

## Outbox data model

`FamilyNotificationOutboxEvent` → table `family_notification_outbox_events` (migration
`20260826090000_family_notification_outbox`). **Strict explicit columns only — no arbitrary JSON, no recipient
ids, no child-safety content.**

| column | purpose |
|---|---|
| `id` | cuid PK |
| `tenantId` | tenant isolation (FK → tenants, ON DELETE CASCADE; RLS key) |
| `notificationType` | `NotificationType` enum (Phase 3A: only `family_delivery_available`) |
| `sourceType` / `sourceId` | bounded routing — the canonical source kind + its id (`safety_signal_delivery` + deliveryId) |
| `eventVersion` | a stable, persisted state-transition marker (never a processor clock / retry time / random) |
| `dedupeKey` | sha256 of the identity tuple; the DB unique index is the final dedupe authority |
| `occurredAt` | when the source transition happened |
| `status` | `FamilyNotificationOutboxStatus` enum: `pending` → `processing` → `completed` / `dead_letter` |
| `attemptCount` | bounded retries (incremented on each claim) |
| `nextAttemptAt` | earliest eligible time (backoff schedule) |
| `lockedAt` / `lockExpiresAt` | time-based processing lease (crash recovery) |
| `completedAt` | terminal-success timestamp |
| `lastErrorCode` | **bounded** error code only — never raw exception/Prisma/SQL text |
| `safeReasonCode` | **bounded** terminal-success classification |
| `createdAt` / `updatedAt` | audit |

Indexes: `@@unique([tenantId, dedupeKey])`, `@@index([status, nextAttemptAt, createdAt, id])` (claim order),
`@@index([tenantId, notificationType, sourceId])`. **Events are never physically deleted by normal processing.**

### Allowed operational fields vs. forbidden data

Allowed: `notificationType`, `sourceType`, `sourceId`, `eventVersion`, `occurredAt`, `safeReasonCode` (+ bounded
lifecycle/lease/error columns). **Never stored:** recipient ids, guardian emails, child names, signal content,
delivery payload, reviewer notes, evidence, consent notes, authorization reasons, invitation tokens, incident
narratives, protection-plan actions, or arbitrary free text.

## Database security

Tenant-scoped, **RLS ENABLED + FORCED** with a `tenant_isolation` policy
(`USING/WITH CHECK tenantId = current_app_tenant_id()`). The app role (`tamanor_app`, non-BYPASSRLS) is granted
**SELECT, INSERT, UPDATE only — never DELETE/TRUNCATE**; the migration additionally `REVOKE DELETE, TRUNCATE`, and
`set-app-role-password.ts` re-asserts that revoke after its blanket grant so a provisioning re-run never re-opens
DELETE. The canonical delivery service inserts the outbox row in the SAME transaction as the transition (app
role). The trusted processor runs as the **owner** (`systemDb`, BYPASSRLS) so it can claim across tenants, but
**every processor statement carries an explicit `tenantId` constraint**, and the actual notification rows are
written by the public `createAuthorizedFamilyNotification`, which re-opens a tenant-scoped RLS transaction. No
browser/public-API path exists (enqueue + processor are **not** barrel-exported). The child-safety owner-only
incident/protection-plan tables are untouched (0 `tamanor_app` grants).

## Event dedupe

`familyNotificationOutboxDedupeKey({ tenantId, notificationType, sourceType, sourceId, eventVersion })` = sha256
of the pipe-joined tuple. Pure — depends on nothing volatile (no recipients, retry/worker clock, attempt number,
email, or content). Same canonical transition (same persisted `eventVersion`) → same key → the unique index
collapses re-enqueues to one row; a genuinely new lifecycle version → new key → new event. Insertion uses
`createMany({ skipDuplicates: true })` (= `INSERT … ON CONFLICT (tenantId, dedupeKey) DO NOTHING`) — never
race-prone check-then-insert.

## Canonical enqueue service

`enqueueFamilyNotificationOutboxEventTx(tx, { tenantId, notificationType, source, eventVersion, occurredAt })`
(internal). Phase 3A accepts **only** `family_delivery_available` (closed union at compile time; a runtime guard
fails closed). It derives `sourceType`/`sourceId`/`dedupeKey` and the bounded event fields. The caller supplies no
recipients, title/message, severity, route, metadata, status, attempt, or lock state. Returns
`{ enqueued, duplicate, outboxEventId? }`.

## Delivery-available trigger integration point

`makeSafetySignalDeliveryAvailable(actor, id, now?)` in `packages/db/src/child-safety-delivery.ts`. The generic
`transition(...)` helper gained an optional in-transaction `afterUpdate` hook; the available-transition passes a
hook that enqueues the event inside the SAME `withTenant` transaction. Sequence: validate transition → persist
`available` (+ `availableAt`) → audit → enqueue one `family_delivery_available` event → commit together. If the
enqueue throws, the whole transaction rolls back (a delivery is never left available without its durable event).
This is the ONLY wired trigger — no route, UI action, or after-the-fact controller enqueues.

**eventVersion source:** `String(availableAt.getTime())` — the persisted, write-once availability timestamp. The
invalid-transition guard prevents an already-available delivery from re-transitioning, so it is stable across
retries; the outbox unique index is the final dedupe authority regardless.

## Worker claim & lease model

`processFamilyNotificationOutboxBatch({ batchSize?, now?, workerId? })` (server-only). Claims with a single
`UPDATE … WHERE id IN (SELECT … ORDER BY nextAttemptAt, createdAt, id LIMIT n FOR UPDATE SKIP LOCKED)`, moving
eligible rows (`pending` and due, OR `processing` with an expired lease) to `processing`, stamping
`lockedAt`/`lockExpiresAt` (5-min lease) and incrementing `attemptCount`. `SKIP LOCKED` → concurrent workers take
disjoint rows; a crashed worker's row becomes claimable once its lease expires; an active lease is never stolen.
Batch size is bounded to `[1, 500]`.

## Retry / backoff & dead-letter

Constants: `OUTBOX_MAX_ATTEMPTS=5`, `OUTBOX_BASE_RETRY_DELAY_MS=60_000`, `OUTBOX_MAX_RETRY_DELAY_MS=3_600_000`,
`OUTBOX_LEASE_DURATION_MS=300_000`, `OUTBOX_DEFAULT_BATCH_SIZE=50`, `OUTBOX_MAX_BATCH_SIZE=500`. Backoff is bounded
exponential: `min(MAX, BASE·2^(attempt-1))`. A transient failure (thrown error or `resolver_error`) → back to
`pending` with `nextAttemptAt` in the future and a bounded `lastErrorCode=processing_error`. When `attemptCount`
reaches `MAX_ATTEMPTS` → `dead_letter` (`max_attempts_exceeded`). Permanent conditions dead-letter immediately:
unsupported type (`unsupported_type`), malformed source (`malformed_event`), bad marker (`invalid_event_version`),
contradictory linkage (`contradictory_linkage`). **`lastErrorCode` is always a bounded catalogue value** — no
stack traces, Prisma messages, SQL, embedded ids, tenant names, emails, or child-safety details. Dead-letter rows
are retained for audit — never auto-deleted.

## Current-authorization processing (intentional)

The outbox event does **not** freeze access. At processing time `createAuthorizedFamilyNotification` re-runs the
full live chain (membership, guardian relationship, authority, consent, safe-recipient assessment, recipient
authorization, delivery eligibility). Therefore: authorized-at-enqueue but revoked-before-processing → receives
nothing; unauthorized-at-enqueue but validly-authorized-before-processing → may receive it when current product
rules permit; a previous notification does not grant access; outbox ownership does not grant access. Terminal
success classifications: `delivered`, `already_delivered`, `no_recipients`, `source_gone`, `not_applicable`. A
zero-recipient result is a completed success, not a failure.

## Crash recovery (at-least-once event, exactly-once rows)

The critical window — notification rows committed but the outbox event not yet marked `completed` — is recovered
without distributed transactions. On lease-expiry reclaim, the processor re-runs
`createAuthorizedFamilyNotification`, which uses the notification `@@unique([tenantId, dedupeKey])` constraint
(`createMany skipDuplicates`) so the re-run returns all-duplicates (`createdCount=0`), creates no second rows, and
marks the event `completed`. Two independent unique indexes (outbox identity + notification identity) give
exactly-once observable notification rows under at-least-once event delivery.

## Operational command & health

- `pnpm family-notifications-outbox:process` — asserts a safe local DB target, processes ONE bounded batch, prints
  aggregate counts only (`claimed / completed / retried / dead_letter / notifications_created / duplicates /
  no_recipients`), exits non-zero on processor failure. **No scheduler / cron is configured** in this sprint.
- `getFamilyNotificationOutboxHealth(now)` — read-only aggregate counts: `pending`, `processing`, `lease_expired`,
  `retry_due`, `dead_letter`, `oldestPendingAgeBucket` (bounded bucket). No ids/tenants/recipients.

## Tests

- `family-notifications-outbox:test` — 49 DB assertions: schema/security (RLS forced, no app DELETE, incident/plan
  grants unchanged), enqueue (atomic-with-transition, forced-rollback, dedupe, new-version, no recipient/PII
  columns, unsupported-type + cross-tenant rejected), claiming (bounded batch, deterministic order, no double-claim
  of an active lease, lease-expiry reclaim, active-lease not stolen), processing (single/multiple recipients,
  revoked-before-processing → zero, duplicate → no dupes, completed not re-claimed, malformed → dead-letter,
  source-gone), retry (schedule, single increment, bounded backoff, not-before/at due, max→dead-letter, no raw
  text), crash recovery (no dupes, marks completed, racing workers → one row), privacy/health (counts only, no
  ids, strict metadata, safe route without id), and targeted regression.
- `family-notifications-source:test` — extended with the Phase 3A boundary invariants (single wired trigger owned
  by the delivery transition; no route/UI enqueue; explicit-column schema with no JSON/recipient field; processor
  goes only through the public entry; bounded error codes only; no hard-delete; no scheduler/channels; RLS in the
  migration; provisioning re-asserts the outbox no-DELETE).

Full dependent gate stays green (delivery 65/65, recipient-auth 46/46, protection-plan 50/50, reviewer 68/68, all
Family suites, Business notifications 13/13). Clean-DB migration replay verified.

## Phase 3B1 — advisory lifecycle triggers (delivered)

Phase 3B1 wires **five** more canonical live triggers onto the same durable outbox, taking the enqueue service to
**six** supported types. The other seven remain fail-closed. Nothing in the Phase 3A architecture changed
(explicit columns, no JSON/recipient ids, RLS forced, app-role SELECT/INSERT/UPDATE only, lease/backoff/
dead-letter, current-authorization processing, exactly-once rows).

### The six wired notification types + canonical integration points

| type | canonical service (integration point) | sourceType | eventVersion source |
|---|---|---|---|
| `family_delivery_available` | `makeSafetySignalDeliveryAvailable` (Phase 3A) | `safety_signal_delivery` | write-once `availableAt` epoch ms |
| `family_delivery_acknowledged` | `acknowledgeSafetySignalDelivery` | `safety_signal_delivery` | write-once `acknowledgedAt` epoch ms |
| `family_delivery_declined` | `declineSafetySignalDelivery` | `safety_signal_delivery` | write-once `declinedAt` epoch ms |
| `family_guardian_invitation_accepted` | `acceptFamilyGuardianInvitation` | `family_guardian_invitation` | write-once `acceptedAt` epoch ms |
| `family_authority_changed` | `verify` / `grant` / `changeLevel` / `suspend` / `resume` / `revoke` guardian-authority services (via `enqueueAuthorityChangedIfMaterialTx`) | `guardian_authority_record` | post-transition `updatedAt` epoch ms (material transitions only) |
| `family_recipient_authorization_changed` | `createRecipientAuthorizationDecision` / `revoke` / `supersede` | `recipient_authorization_decision` | new decision → immutable **decision id**; lifecycle change → `rev:<revokedAt>` / `sup:<supersededAt>` |

The single source of truth for (type → sourceType, id field) is `OUTBOX_TYPE_SOURCE` in
`internal/family-notification-outbox.ts`; both the enqueue service and the processor route through it, so they
can never drift. Enqueue happens ONLY inside these canonical domain services — never a route, UI action, audit
listener, later read process, or Prisma middleware.

### Atomic enqueue & rollback

Each trigger enqueues in the SAME transaction as its canonical transition (the delivery transitions and the
authority/recipient-authorization services run under `withTenant`; invitation acceptance runs under
`systemDb.$transaction`). If the enqueue throws, the whole canonical transition rolls back — a delivery is never
left acknowledged/declined, an invitation never accepted, an authority/decision never transitioned, without its
durable outbox marker. Repeated/ idempotent transitions do not enqueue a second event (invalid-transition guards +
idempotent early-returns + the outbox unique index).

### Material authority-change definition

`family_authority_changed` fires only on a **material EFFECTIVE-authority change**, decided by an explicit bounded
comparison (`isMaterialAuthorityChange(before, after)`), never a bare `updatedAt` inequality. EFFECTIVE authority
= status `verified`. Material = effectiveness flipped (became/ceased effective: verify, grant, suspend, resume,
revoke-from-verified) **or** the granted scope (`authorityLevel`) changed while effective. Non-material (no event):
creating a pending record, reject (pending→rejected, never effective), revoking an already-suspended (already
not-effective) authority, idempotent no-ops, or a scope edit while suspended.

### Material recipient-authorization-change definition

`family_recipient_authorization_changed` fires on a **new decision** (decisions are append-only → the immutable
decision id is the eventVersion; a genuinely new decision = new id = new event) or a **material lifecycle
transition** of an existing decision (revoke / supersede → a distinct `rev:`/`sup:` eventVersion). Idempotent
no-ops (revoking an already-revoked decision) enqueue nothing.

### Processor source routing

`buildAuthorizationSource(ev)` maps each `(notificationType, sourceType)` row to the exact typed
`FamilyNotificationAuthorizationSource` via `OUTBOX_TYPE_SOURCE`. Any other combination (or unknown type) is a
PERMANENT `malformed_event` → dead-letter (never retried). All recipient/relationship information is derived by the
resolver from the canonical source record at processing time; the outbox carries only bounded ids.

### Strict privacy projections

The outbox stores only bounded routing (`sourceType`, `sourceId`, `eventVersion`, timestamps, bounded codes). The
trigger call-sites pass only ids: the invitation trigger passes the invitationId (never token/email/user id); the
authority trigger passes the record id (never notes/evidence/scope detail/reviewer identity); the
recipient-authorization trigger passes the decision id (never disclosure scopes, reason text, evaluator facts, or
the recipient membership id).

### Tests & clean-DB

- `family-notifications-outbox-advisory:test` — 54 DB assertions (type/source security, per-trigger atomic
  enqueue + forced-rollback + stable eventVersion + no-content, processing with current authorization, materiality,
  idempotency/retry/crash/concurrency, mixed-batch, dead-letter, static boundary).
- `family-notifications-source:test` — extended to 50 (six wired types owned by their canonical services; the
  seven deferred types not wired; per-trigger privacy projections; no middleware-generated events).
- Full gate green (delivery 65/65, recipient-auth 46/46, guardian-authority 140/140, guardian-invitation 164/164,
  consent-lifecycle 123/123, all Family suites, Business notifications 13/13). **No new migration** was required;
  clean-DB replay re-verified (RLS forced, app-role no DELETE, incident/plan grants 0, delivery CHECKs present).

## Phase 3B2 — critical safety-signal & incident triggers (delivered)

Phase 3B2 wires the **four safety-critical triggers**, taking the outbox to **ten** supported types. The remaining
**three** (`family_guardian_invitation_expiring`, `family_consent_expiring`, `family_protection_plan_updated`) stay
fail-closed. All Phase 3A/3B1 invariants are preserved.

### The ten wired types (Phase 3B2 additions)

| type | canonical Family-notifiable transition | sourceType | eventVersion |
|---|---|---|---|
| `family_signal_available` | `confirmSafetySignalRisk` (→ confirmed_risk), severity low/medium | `safety_signal` | `available:<reviewedAt epoch ms>` |
| `family_urgent_signal` | `confirmSafetySignalRisk` (→ confirmed_risk), severity high/critical | `safety_signal` | `urgent:<reviewedAt epoch ms>` |
| `family_incident_created` | `correlateAndLinkSignal` (new incident opened + signal linked) | `child_safety_incident` | `created:<openedAt epoch ms>` |
| `family_incident_escalated` | `createOrReuseEscalation` (new escalation record) | `child_safety_incident` | `escalated:<escalation record id>` |

### Canonical Family-notifiable signal transition + writer coverage

A raw inbound signal is **not** Family-visible. The **sole** trusted, Family-notifiable transition is
`confirmSafetySignalRisk` → `ConfirmedRisk` (audited: it is the only writer of `confirmed_risk`). Raw
create/ingest (`new`), acknowledge, under-review, and **dismissed** (quarantined/false-positive) never enqueue.
The enqueue fires only on the genuine first transition INTO `confirmed_risk` (a re-confirm does not re-enqueue).

### Mutually exclusive normal/urgent policy + urgent-promotion materiality

At confirmation, the signal's severity selects **exactly one** type: low/medium → `family_signal_available`,
high/critical → `family_urgent_signal` (never both). **Audited: `SafetySignal.severity` is immutable after
creation — there is no canonical severity-mutation writer — so no separate urgent-promotion event is enqueued.**
The pure rule `isMaterialUrgentSignalTransition(before, after)` (true only when crossing low/medium → high/critical;
high→critical is NOT treated as a new urgent lifecycle event) is implemented and unit-tested, ready for the day
severity becomes mutable. Urgency changes presentation only — it never bypasses membership, guardian relationship,
authority, consent, safe-recipient assessment, recipient authorization, or disclosure-scope evaluation (the
processor re-runs the full chain).

### Incident creation & escalation integration points

- **Creation:** `correlateAndLinkSignal` (owner `systemDb.$transaction`). The enqueue fires only for a genuinely
  **new** incident (`createdIncident`), which is always opened `Open` (non-escalated) and linked to ≥1 signal on
  one profile. Grouping a signal into an existing incident is not a creation event.
- **Escalation:** `createOrReuseEscalation`. The escalation record create + incident `escalationState="escalated"`
  + enqueue are now wrapped in one `systemDb.$transaction`, firing only for a **new** escalation record
  (`createdEscalation`); reused/idempotent escalations enqueue nothing. Escalation never broadens recipients — the
  processor re-uses the same linked-signal visibility authority.

### Directly-escalated incident policy

Audited: creation always opens a **non-escalated** incident and escalation is always a **distinct later**
transition, so one atomic transition never emits both `created` + `escalated`. Creation enqueues
`family_incident_created`; a later escalation enqueues `family_incident_escalated` — one event per transition.

### Owner-only transaction strategy

Incident/incident-signal/escalation tables remain owner-only (**0 `tamanor_app` grants**). Their triggers run in
the canonical **owner** (`systemDb`) transaction and enqueue through `enqueueFamilyNotificationOutboxEventOwnerTx`
— a thin owner-boundary wrapper that **delegates to the single core enqueue primitive** (identical validation +
dedupe; no duplicated logic). It writes the outbox row in that SAME owner transaction (BYPASSRLS) with an explicit
trusted `tenantId`; no nested/separate transaction escape. The tenant-scoped writers keep using the RLS path.

### Authorization-readiness audit & selected policy (Option B)

**Audited ordering:** recipient authorization decisions are created independently of, and often AFTER, signal
confirmation / incident creation. Completing a critical event as `no_recipients` immediately would permanently lose
the notification if authorization is established moments later. **Selected: Option B — bounded
authorization-readiness retry.** For the four critical types only, when processing returns a currently-valid,
disclosable source with **zero** authorized recipients, the event is held `pending` with a bounded
`authorization_pending` marker and deterministic backoff (`OUTBOX_READINESS_MAX_ATTEMPTS`=8, 1 min→15 min ceiling)
for a finite window; after the window it completes `no_recipients`. A permanent denial / invalid source is
terminal (never a loop); a decision added during the window delivers exactly once (notification dedupe). No
recipient ids or raw authorization details are stored — only the bounded readiness code.

### Privacy

Trigger projections pass only bounded ids (safetySignalId / incidentId) + a stable eventVersion + occurredAt —
never signal content, severity, source reference, incident narrative, escalation reason, evidence, or reviewer
identity. The outbox has no content/JSON/recipient columns; logs and health are aggregate + bounded-code only.

### Tests & clean-DB

- `family-notifications-outbox-critical:test` — 56 DB assertions (type/source boundary, signal available/urgent
  incl. mutual exclusion + raw/dismissed non-enqueue + rollback + no-content, incident created incl.
  multi-profile fail-closed + rollback, escalation incl. reused/reversed + rollback, directly-escalated policy,
  authorization-readiness incl. added-during-window / exhaustion / no-duplicate, owner-tx security, worker/recovery).
- `family-notifications-source:test` — extended to 57 (ten wired types; three deferred not wired; signal owned only
  by confirm-risk; incident/escalation owner-tx no-escape; readiness bounded).
- Full gate green (delivery 65, recipient-auth 46, reviewer 68, protection-plan 50, guardian-authority 140,
  guardian-invitation 164, safety-signal 32, incident-domain 36, incident-core 32, ingest-integrity, Business 13).
  **No new migration**; clean-DB replay re-verified (RLS forced, app-role no-DELETE, incident/escalation/plan
  grants 0, delivery CHECKs present, 13 enum values).

## Phase 3B3 — protection-plan update trigger (delivered)

Phase 3B3 wires the final non-expiry trigger, `family_protection_plan_updated`, taking the outbox to **eleven**
supported types. The remaining **two** (`family_guardian_invitation_expiring`, `family_consent_expiring`) belong to
Phase 3C (deterministic expiry evaluation + a production scheduler). All Phase 3A/3B1/3B2 invariants are preserved.

### Canonical protection-plan writers audited

- `createDraftProtectionPlan` → creates a **draft** plan only (never active) → **never enqueues** (creation is
  never Family-disclosable).
- `activateProtectionPlan` (draft/reopened → **active**), `reopenProtectionPlan` (completed/cancelled →
  **reopened**), `completeProtectionPlan` (→ completed), `cancelProtectionPlan` (→ cancelled) — all go through the
  single canonical `transitionPlan` (owner `systemDb.$transaction`), which bumps the plan `revision` (optimistic
  concurrency).
- Action writers (`addProtectionAction`, assign/unassign/due-date/priority, `transitionAction` = start/block/
  complete/skip/reopen) mutate **actions**, do **not** bump `plan.revision`, and are internal reviewer workflow →
  **never enqueue**.

The trigger is wired into `transitionPlan` (the sole canonical plan-status writer) — no Prisma middleware, no
audit listener, no route/UI.

### Family-disclosable plan-state allow-list

`FAMILY_DISCLOSABLE_PLAN_STATES = { active, reopened }` (exact Phase 2b allow-list — an explicit set, **never**
`status !== "deleted"`). draft / completed / cancelled / any reviewer-only state are NOT disclosable. A source
invariant asserts the enqueue-module allow-list matches the resolver/visibility allow-list byte-for-byte.

### Material plan-update definition

`isMaterialFamilyProtectionPlanUpdate(before, after)` = `before.status !== after.status &&
FAMILY_DISCLOSABLE_PLAN_STATES.has(after.status)` — a canonical status transition that **lands in** a
Family-disclosable state (draft→active, reopened→active, completed/cancelled→reopened). Leaving a disclosable
state (active/reopened → completed/cancelled) is NOT material (there is no "plan closed" catalogue type); draft
creation and internal action/reviewer changes are NOT material. Never a bare `updatedAt` inequality. Every
material transition bumps `revision`, giving the stable per-transition eventVersion.

### Plan creation / activation policy

Plans are always created as **draft** (no direct-active creation path exists), so creation never enqueues; the
**first** notification is on activation. One atomic `transitionPlan` operation → exactly **one** event (never one
per field mutation).

### eventVersion sources

`active:<revision>` (draft/reopened → active) and `reopened:<revision>` (completed/cancelled → reopened), where
`<revision>` is the just-incremented canonical `revision` (monotonic, write-once per transition). A retry of the
same transition reuses the same revision → same eventVersion; a new material revision → a new eventVersion.

### Owner transaction strategy

The plan table is owner-only (**0 `tamanor_app` grants**). The trigger enqueues via
`enqueueFamilyNotificationOutboxEventOwnerTx` inside `transitionPlan`'s existing `systemDb.$transaction` (the SAME
supplied owner tx, explicit `tenantId`) — no nested/separate transaction escape. Enqueue failure rolls the whole
plan transition back (status + revision unchanged).

### Processor routing & current authorization

`buildAuthorizationSource` routes `(family_protection_plan_updated, child_safety_protection_plan)` →
`{ type, protectionPlanId, eventVersion }`; any other combination → permanent `malformed_event` → dead-letter. At
processing time the resolver re-runs plan → `loadFamilyDisclosablePlan` → linked incident →
`evaluateFamilyIncidentVisibility` → current authorization for ≥1 linked signal: revoked-before-processing →
nothing; newly-authorized → may receive; manager/owner/reviewer role alone → nothing; another profile's
authorization → nothing; a plan that became non-disclosable before processing → completes with zero notifications.

### Readiness decision (no readiness for plans)

`family_protection_plan_updated` is **not** one of the four critical readiness types. Audit: plan activation is a
deliberate later workflow step on an existing incident; there is no proven canonical ordering that commits an
active plan *before* its linked-signal authorization such that completing `no_recipients` would reliably lose an
intended notification. Default applied: **zero authorized recipients → completed `no_recipients`**; non-disclosable
→ terminal (soft-empty → `no_recipients`); missing plan → `source_gone`; contradictory linkage → the resolver's
existing bounded classification. The Phase 3B2 `authorization_pending` window is NOT applied to plans.

### Privacy

The trigger passes only `tenantId`, the type, the canonical `protectionPlanId`, a stable eventVersion, and
`occurredAt` — never plan title/narrative, action text/status, evidence, reviewer notes, policy facts, or
incident/signal ids. The outbox has no content/JSON/recipient columns; notification metadata carries no plan/
incident id; logs/health are aggregate + bounded-code only.

### Tests & clean-DB

- `family-notifications-outbox-protection-plan:test` — 36 DB assertions (type/source boundary, materiality:
  draft/action/complete/cancel non-events + activate/reopen/re-activate events + stable revision eventVersion,
  atomic activate/reopen + forced-rollback + no-escape, current authorization incl. revoked / non-disclosable /
  other-profile, source integrity incl. cross-tenant / missing-plan / 0 grants, privacy, crash recovery).
- `family-notifications-source:test` — extended to 63 (eleven wired types; two expiry types unwired; plan owned by
  `transitionPlan`; draft-creation non-enqueue; allow-list match; plan not a readiness type).
- Full gate green (delivery 65, recipient-auth 46, reviewer 68, protection-plan 50, incident-domain 36, all Family
  suites, Business 13). **No new migration**; clean-DB replay re-verified (RLS forced, app-role no-DELETE,
  plan/incident/escalation grants 0, delivery CHECKs present, 13 enum values).

## Phase 3C — deterministic expiry evaluators & production scheduler (delivered)

Phase 3C completes the final two triggers — `family_guardian_invitation_expiring` and `family_consent_expiring` —
so **all 13 Family notification catalogue types are now wired**. It adds deterministic expiry evaluators, a
DB-backed scheduler lease, a bounded runner, an authenticated production cron endpoint, and the `*/5` schedule
config. (This does NOT mean the Family Notification Center, preferences, or external delivery channels are
complete.)

### The 13 wired types (Phase 3C additions)

| type | trigger | sourceType | eventVersion |
|---|---|---|---|
| `family_guardian_invitation_expiring` | `evaluateExpiringGuardianInvitations` (scheduled) | `family_guardian_invitation` | `invitation-expiring:v1:<expiresAt epoch ms>` |
| `family_consent_expiring` | `evaluateExpiringConsents` (scheduled) | `consent_record` | `consent-expiring:v1:<validUntil epoch ms>` |

### Warning policy + exact boundaries (UTC)

- **Invitation:** exactly one warning when a `pending` invitation enters the final **24 hours** before `expiresAt`.
- **Consent:** exactly one warning when an **effective** consent enters the final **14 days** before `validUntil`.
- Eligibility boundary: `expiry > now AND expiry <= now + window`. Already-expired sources never warn. An
  extended expiry or a renewed/replaced consent is a **new expiry version** → at most one new warning. No repeated
  daily reminders (the outbox unique index collapses re-scans to one event per `(source, expiry version)`).

### Lifecycle states audited

- **Invitation eligible** = `status = "pending"` only. Ineligible: accepted / declined / revoked / expired /
  outside-window / already-past / missing expiry.
- **Consent eligible** = `consentStatus = "active"` AND `revokedAt IS NULL` AND `archivedAt IS NULL` AND a
  `validUntil` in `(now, now+14d]` (mirrors the existing effective-consent rule — no second definition).
  Ineligible: pending / rejected / revoked / superseded (any non-active status) / indefinite (no expiry) /
  already-expired.

### eventVersion + stale-expiry protection

eventVersions encode the canonical expiry instant (never a scheduler/worker clock, attempt, or random). At
**processing** time the resolver re-validates: source still exists + still in the eligible state + **current expiry
equals the eventVersion-encoded expiry** + `now < expiry`. A mismatch (extended / renewed / accepted / revoked /
elapsed) → **`not_applicable`** (a later evaluator pass may enqueue one new event for the new version). This
replaced the old 7d/1d window param on these two resolver sources.

### Evaluator architecture, pagination & index audit

Owner (`systemDb`) cross-tenant scanners with an explicit `now`, a bounded batch (default 100, hard max 500),
deterministic `ORDER BY (expiry, id)` and optional keyset continuation (never skips equal-expiry rows). They read
**narrow projections only** (invitation: `id, tenantId, expiresAt` — never token/email/message; consent:
`id, tenantId, validUntil` — never notes/evidence/reason), **never mutate the source** (no `warningSentAt`), never
create a notification row, and enqueue through the bounded owner outbox wrapper with an explicit `tenantId`,
returning aggregate counts only. **Index audit / migration:** the cross-tenant scans filter by status/expiry with an
id tie-break, which the old per-tenant indexes did not order — so migration `20260827090000_family_notification_
scheduler` adds `family_guardian_invitations (status, expiresAt, id)` and `consent_records (consentStatus,
validUntil, id)` (plus the lease table). **A migration WAS required** (new lease table + two scan indexes);
nothing existing was modified/reset.

### Concurrent dedupe

Two concurrent evaluator runs (or re-scans) over the same source produce exactly one outbox row (unique
`(tenantId, dedupeKey)` with `INSERT … ON CONFLICT DO NOTHING`) and exactly-once observable notification rows (the
notification dedupe). The scheduler lease reduces duplicate work but is **not** the dedupe authority.

### Current authorization

Processing re-uses the existing recipient rules: invitation-expiring → active inviter (from
`invitedByMembershipId`) + current `FamilyInvitationView` managers, deduped; consent-expiring → current
`ConsentManage` managers. Revoked/inactive-before-processing users receive nothing; a newly-eligible manager may
receive; a prior notification / outbox ownership / platform role alone grants no access. Expiry warnings are
advisory — they do **not** use the Phase 3B2 `authorization_pending` readiness window.

### Scheduler infrastructure

**Audited** existing production scheduling: Vercel Cron via `apps/web/vercel.json` + internal job routes under
`/api/internal/jobs/*` authenticated by `assertCronAuth` (`CRON_SECRET`, fail-closed, constant-time). **Reused**
that mechanism (no competing scheduler). **Lease:** `SyncLease` is per-connected-account/tenant, unsuitable for a
global scheduler lease, so a focused additive **`scheduler_leases`** table was added (owner-only, 0 `tamanor_app`
grants) — atomic acquire via `INSERT … ON CONFLICT DO UPDATE … WHERE expiresAt < now`, a live lease can't be
stolen, an expired lease is recoverable, only the holder token can release, a crash lets it expire; it stores no
tenant/user/source id and is not the dedupe authority.

**Runner:** `runFamilyNotificationScheduler` — acquire lease → evaluate invitations → evaluate consents → drain the
outbox in bounded batches (stop on empty / `batch_limit` / `time_budget`) → release. Returns aggregate counts + a
bounded `stoppedReason` only. **Endpoint:** `GET /api/internal/cron/family-notifications` (Node.js runtime,
`force-dynamic`, `Cache-Control: no-store`) requires `Authorization: Bearer $CRON_SECRET` (no cookie/session/
query-string secret; fail-closed if the secret is unset; generic 401; constant-time; never logged/echoed), calls
only the shared runner with **no caller-controlled input** (a caller cannot raise bounds or choose a tenant/
source), and returns aggregate counts only. **Schedule:** exactly one `*/5 * * * *` entry in `apps/web/vercel.json`
(the three pre-existing jobs are unchanged). **Cadence:** every 5 minutes. **Local command:**
`pnpm family-notifications-scheduler:run` (safe-target, one bounded cycle, aggregate counts only, non-zero on
failure, no loop). `pnpm family-notifications-outbox:process` is unchanged.

### Operational health

`getFamilyNotificationSchedulerHealth(now)` → outbox aggregates (pending, processing, lease_expired, retry_due,
dead_letter, oldest-pending age bucket) + `invitationsInWindow` / `consentsInWindow` + scheduler lease state
(`free` / `active` / `expired`). Aggregate + bounded-code only; no ids/tenants/emails/timestamps.

### Required production variable

`CRON_SECRET` (the repository-standard cron secret shared by every internal job route) — required in production,
fail-closed if unset, sufficiently long, never logged or returned. (No new per-feature secret was introduced.)

### Committed code vs. verified production activation

Phase 3C **committed and locally verified** the evaluators, lease, runner, endpoint, and `*/5` config. Production
scheduling is **NOT** proven by a committed cron config alone — it additionally requires: deployed code, deployed
cron config, a configured production `CRON_SECRET`, valid production DB variables, and at least one authenticated
production invocation with an aggregate result verified without identifiers. Those deployment steps are outside
this local sprint and remain **unverified**.

### Tests & clean-DB

- `family-notifications-expiry:test` (44) — type map, invitation/consent boundary + state eligibility,
  eventVersion, stale-expiry → not_applicable, current authorization, evaluator determinism/bounds/ordering/no-
  mutation, processor + no-readiness.
- `family-notifications-scheduler:test` (32) — lease (acquire / busy / no-steal / expired-recover / owner-token /
  crash / no ids / 0 grants), runner (staged bounded cycle / time-budget / batch-limit / empty / aggregate-only),
  endpoint auth (missing / wrong / query-string / cookie / correct / missing-secret / no-store / aggregate-only /
  no caller bounds), and schedule config (exactly one `*/5` entry in the deployed root, unrelated jobs unchanged).
- `family-notifications-source:test` extended to 79 (all 13 wired; evaluator narrow projections; no source
  mutation; explicit windows; stale-expiry validation; DB lease; bearer-only cron; aggregate-only route; no
  competing scheduler).
- Full gate green. Clean-DB replay verified: migration applies, RLS forced, app-role no-DELETE, owner-only +
  scheduler-lease 0 grants, both expiry indexes present, 13 enum values.

## Remaining scope — Family Notification Center (NOT in Phase 3)

All 13 triggers, the durable outbox, the processor, the expiry evaluators, and the authenticated scheduler path are
implemented. Still unbuilt: notification preferences, `/family/notifications`, the Family shell bell, notification
UI actions, Family-facing incident/plan routes, and any email / push / SMS / webhook / external-messenger delivery
channel. And, per the deployment-honesty note above, production scheduler activation is unverified until a real
deployed, secret-configured, authenticated production run is observed.
