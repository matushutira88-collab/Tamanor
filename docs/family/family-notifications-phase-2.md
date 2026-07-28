# Family Notifications — Phase 2 (Database, Persistence & Service Foundation)

Status: **persistence + services implemented & DB-verified**; the recipient **authorization resolver** and all
live triggers/UI are **deferred** (see "Not implemented"). Foundation: commit `5d3ce6d` (Phase 1 catalogue).

## Reused generic notification infrastructure (no second table)
Family notifications reuse the existing tenant-scoped `Notification` model + `notification-repo` — NOT a parallel
table:
- `Notification` (`notifications`): `tenantId`, nullable `userId`, `type: NotificationType`, `severity`,
  `titleKey`/`messageKey`, `metadata: Json`, `dedupeKey`, `readAt`, **`dismissedAt` (new)**, `emailSentAt`;
  `@@unique([tenantId, dedupeKey])`; RLS ENABLE + FORCE + tenant_isolation policy (enforced via `withTenant`).
- Dedupe is the DB unique constraint — the final authority for idempotency.

## Family-specific separation
- Family reads/writes are ALWAYS filtered to the 13 `family_*` types + `userId = actor.userId`; Business and
  tenant-wide (`userId = null`) rows can never appear in the Family surface, and Business behaviour is untouched.
- Every Family notification is **per-recipient** (`userId` non-null). Tenant-wide Family notifications are rejected.

## Migration
`20260825090000_family_notifications` — additive, forward-only, replay-safe (`IF NOT EXISTS`):
1. 13 `family_*` values added to `NotificationType` (matching core `FAMILY_NOTIFICATION_TYPES`).
2. `dismissedAt TIMESTAMP(3)` nullable (soft dismiss; independent of `readAt`; no backfill; Business never sets it).
3. Index `notifications_tenantId_userId_dismissedAt_readAt_createdAt_id_idx` for the Family center query.
Existing Business indexes preserved. RLS unaffected (row-level; the app-role table grant already covers the new
column). No resets, no destructive enum recreation, no DELETE grant added.

## Strict metadata schema (privacy)
Family persistence uses ONLY the Phase-1 `buildFamilyNotificationMetadata` + a defence-in-depth
`assertFamilyNotificationMetadata` allow-list. Allowed keys: `notificationType, severity, entityType, entityId,
profileId?, createdAt?, safeReasonCode?, safeRoute`. Any other key, any forbidden-resembling key (message,
content, name, email, token, note, dob, age, evidence, stripe, …), and any nested object/array are REJECTED. The
soft generic `sanitizeNotificationMetadata` is NOT used for Family rows. `safeRoute` is a base `/family/*` page —
never an entity id or query string.

## Family notification service API (`packages/db/src/family-notification-repo.ts`)
- `createFamilyNotificationTx(tx, input)` / `createFamilyNotification(input)` — persistence primitive. Takes
  RESOLVED, server-authoritative `recipientUserIds`; derives all catalogue fields; one row per recipient.
- `assertFamilyNotificationMetadata(meta)` — strict allow-list validator.
- `listFamilyNotifications(actor, opts)` — Family-scoped, non-dismissed, newest-first (stable `id` tie-break),
  keyset by `(createdAt, id)`, safe projection (malformed row → `unavailable`).
- `familyUnreadNotificationCount(actor)` — Family types, own recipient, not read, not dismissed.
- `markFamilyNotificationRead` / `markAllFamilyNotificationsRead` — own-recipient, active tenant, idempotent.
- `dismissFamilyNotification` — soft dismiss (sets `dismissedAt`, never deletes); only DISMISSIBLE Family types;
  urgent safety types fail closed; idempotent.

## Transaction / idempotency approach
`createFamilyNotificationTx` runs inside the caller's transaction (atomic with the triggering domain event; a
rollback leaves no orphan). Idempotency uses **`createMany({ skipDuplicates: true })`** — transaction-safe: a
`(tenantId, dedupeKey)` conflict is skipped WITHOUT a caught unique-violation that would abort an open Postgres
transaction. Two concurrent same-event calls create exactly one row; a different `eventVersion` creates a new row.

## Read / dismiss semantics
Read and dismiss are independent. Dismiss is a soft hide (audit row retained). Mark-read/all and dismiss all
include `tenantId`, `userId`, and the Family-type filter in the mutation `where`, so cross-user and cross-tenant
calls change zero rows and never reveal existence. No repository hard-delete function exists.

## Canonical authorization services to reuse (Phase 2b resolver — see contract below)
Audited, to be COMPOSED by the resolver (never reinterpreted):
- Family actor/membership: `FamilyActorContext`, `requireFamilyActor`/`requireFamilyConsole` (web guard), `familyAuthorize`.
- Profile: `getProtectedProfile` / `isActiveGuardianRelationship` / profile `protectionStatus`+archived.
- Guardian relationship: `isActiveGuardianRelationship`, `guardianLifecycleState`.
- Effective guardian authority: `getEffectiveGuardianAuthority(actor, guardianRelationshipId, now)`.
- Effective consent + safe-recipient assessment: `child-safety-consent.ts` (ConsentRecord / SafeRecipientAssessment evaluators).
- Recipient authorization: `getEffectiveRecipientAuthorization(actor, safetySignalId, recipientMembershipId, now)`, `evaluateRecipientAuthorization`.
- Delivery eligibility: `evaluateSafetySignalDeliveryEligibility(actor, input, now)`; delivery `recipientMembershipId`.
- Invitation inviter: `family-invitation.ts` (`acceptFamilyGuardianInvitation`, invitation `createdBy…`).
- Protection-plan visibility: `child-safety-protection-plan.ts` visibility authority.

## Trigger-failure policy for future Phase 3 (decision recorded)
**Preferred policy adopted:** authorization ambiguity or resolver failure ⇒ the notification-creation operation
fails closed with **zero** created rows and never mutates the child-safety source domain. Phase 3 must classify
each trigger:
- **rollback-required** when the notification is part of the canonical delivery guarantee (e.g. `delivery_available`
  to the authorized recipient): call `createFamilyNotificationTx` inside the domain transaction; a notification
  failure rolls back the event.
- **durable-recovery / outbox** for advisory notifications (e.g. `guardian_invitation_accepted`): the domain event
  commits first; the notification is created best-effort and retried from a durable marker — never blocking the
  canonical write.
Phase 3 must not silently swallow failures; record the class per trigger.

## Not implemented in Phase 2 (explicit)
- `resolveFamilyNotificationRecipientsTx` (the 6 recipient rules composing the child-safety chain) and its
  authorization DB tests — deferred so the privacy-critical resolver is built + fully tested as one unit.
- Live signal/incident/delivery/invitation/authority/consent/protection-plan triggers.
- Expiry-evaluator execution / scheduling.
- `/family/notifications`, the shell bell, server actions/forms.
- Push, email, SMS, webhook, external messengers, notification preferences.

## Known limitation
The runtime `tamanor_app` role retains the blanket table `DELETE` grant from app-role provisioning
(`set-app-role-password`), so "no DELETE on notifications" is enforced at the **service + source-test** layer
(no hard-delete function; dismiss is soft), not by a per-table revoke (which the provisioning would re-grant).
