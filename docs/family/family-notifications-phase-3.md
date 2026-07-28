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

## Remaining trigger work (NOT in Phase 3A)

The other 12 live triggers (signals, urgent signals, delivery acknowledged/declined, invitation accepted/expiring,
authority changed, consent expiring, recipient-authorization changed, incident created/escalated, protection-plan
updated), expiry scheduling / cron, notification preferences, `/family/notifications`, the shell bell and UI
actions, Family-facing incident/plan routes, and any email/push/SMS/webhook/messenger channel remain unimplemented.
Their recipient RESOLUTION already exists (Phase 2b); Phase 3B+ will enqueue them onto this same outbox.
