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

## Phase 2b-A — internal recipient-authorization kernel (signals + delivery) — IMPLEMENTED & DB-verified
`packages/db/src/internal/family-notification-authorization.ts` — an **internal** module (NOT barrel-exported;
no production/domain module imports it; proven by source invariants). Supports ONLY three catalogue types; every
other Family type fails closed (`unsupported_type`, zero rows).
- **Typed source union** (no recipient/metadata/severity/route/dedupe): `{family_signal_available|family_urgent_signal, safetySignalId, eventVersion, occurredAt?}` and `{family_delivery_available, deliveryId, eventVersion, occurredAt?}`. `eventVersion` is bounded (`/^[A-Za-z0-9._:-]{1,64}$/`); `now` injected.
- **Resolver** `resolveFamilyNotificationRecipientsTx(tx, {tenantId, source, now})` → `{ok:true, recipientUserIds[]}` | `{ok:false, reason}` (`unsupported_type|source_not_found|workspace_mismatch|tenant_mismatch|profile_mismatch|source_state_invalid|authorization_ambiguous|resolver_error`). Fail-closed; raw evaluator/DB errors never escape; recipient IDs never returned to browser callers.
- **Canonical evaluators reused (composed, not reinterpreted):** `getEffectiveRecipientAuthorization` (the full CS-C4 chain — membership+relationship+authority+consent+assessment — re-checked LIVE plus a currently-effective persisted decision) for signals; `evaluateSafetySignalDeliveryEligibility` for delivery. Trusted system actor `role:"owner"` (→ PrimaryGuardian) drives the read-only evaluators; RLS is tenant-scoped.
- **Signal rule:** candidate discovery = ACTIVE guardian relationships for the signal's profile ONLY (never all members). Each candidate must pass `getEffectiveRecipientAuthorization(signalId, guardianMembershipId)`. Profile must be active + not archived. `family_urgent_signal` additionally requires persisted severity ∈ {high, critical} — a caller cannot promote a normal signal.
  **Purpose mapping:** the canonical CS-C4 chain uses the single existing "receive safety information" consent purpose (`REQUIRED_CONSENT_TYPE` inside `evaluateRecipientAuthorization`) + `maxDisclosureScopesForSignal(severity, signalType)`; both supported signal types map to this most-restrictive existing purpose. Urgent does NOT bypass consent/authority/assessment/recipient-authorization (no canonical emergency-override exists; documented as such).
- **Delivery rule:** exactly the canonical recipient of the exact delivery. Requires `deliveryStatus === "available"`, `evaluateSafetySignalDeliveryEligibility` eligible, and the eligibility's `recipientMembershipId` to equal the delivery row's — the membership comes ONLY from the canonical row.
- **Normal ineligibility vs failure:** an individual candidate not currently authorized is excluded (others still returned); source contradiction / evaluator throw / ambiguity → `ok:false`, zero rows.
- **High-level service** `createAuthorizedFamilyNotificationTx(tx, {tenantId, source, safeReasonCode?, now})` → resolves recipients THEN persists via the `@internal` `createFamilyNotificationTx` (catalogue-derived fields, strict metadata, `createMany skipDuplicates`); zero eligible → zero rows; resolver failure → `{ok:false}`, zero rows; result never contains recipient IDs.
- **Low-level primitive** `createFamilyNotificationTx` is now marked `@internal`; a source test proves no live domain module imports the kernel or the primitive.
- **Tests:** `family-notifications-recipients-core` (25) — source/workspace/profile validation, the full chain (each of authority/consent/assessment/relationship/recipient-authorization revoked → zero recipients; inactive profile → zero), urgent-severity gate, exact delivery recipient, acknowledged→none, authorized creation (dedup, new version, resolver-failure → 0, rollback → 0, non-null userId, no recipient IDs). Source boundary invariants added to `family-notifications-source` (25). Bug fixed: the strict metadata validator wrongly rejected the allow-listed `profileId` (substring `file`); the whitelist alone is the authority now.
- **Still deferred to Phase 2b-B:** `family_manager`, `inviter_plus_admins`, `affected_guardian_plus_managers`, consent-expiry recipients, `protection_plan_viewer`, and incident notification resolution.

## Phase 2b-B1 — managers, invitations & affected-guardian rules — IMPLEMENTED & DB-verified
Extends the internal kernel to **10** supported types (the 3 A + 7 B1). The 3 B2 types
(`family_incident_created`, `family_incident_escalated`, `family_protection_plan_updated`) still return
`unsupported_type` — they need the `evaluateFamilyIncidentVisibility` authority (Phase 2b-B2).
- **Source union** extended (bounded): delivery outcomes (`deliveryId`), invitation (`invitationId`, +`expiryWindow` for expiring), authority (`guardianAuthorityRecordId`), consent (`consentRecordId`, +`expiryWindow`), recipient-auth (`authorizationDecisionId`). Exhaustive `switch` proven by `never`.
- **Manager resolution** `resolveAuthorizedFamilyManagersTx(tenantId, action)` — active memberships whose role grants the EXACT canonical `FamilyAction` via the pure `familyRoleCan(familyRoleForMembershipRole(role), action)`; never a role-name or "all admins/owner" shortcut. **Action map:** delivery_acknowledged/declined → `SafetyDeliveryView`; invitation accepted/expiring → `FamilyInvitationView`; authority_changed → `GuardianAuthorityManage`; consent_expiring → `ConsentManage`; recipient_authorization_changed → `SafetyRecipientAuthorizationView`.
- **Delivery outcomes (family_manager):** delivery loaded (narrow), profile active, `deliveryStatus` MUST equal the requested outcome (acknowledged/declined) else zero; the delivery recipient is included only if they independently hold the manager action.
- **Invitations (inviter_plus_admins):** inviter from `invitedByMembershipId` (never email/token — narrow projection omits `invitedEmailNormalized`/`tokenHash`) + `FamilyInvitationView` managers, deduped. Accepted requires `status="accepted"`+`acceptedAt`; expiring requires `status="pending"`+`expiresAt` and the `expiryWindow` to match the Phase-1 helper (a forged window → zero).
- **Authority / recipient-auth (affected_guardian_plus_managers):** affected user derived ONLY from the canonical link (authority→relationship→`guardianMembershipId`; decision→`recipientMembershipId`) — never the caller; + the relevant managers, deduped. Notifications are content-free; the CTA re-guards access (a revoked record grants nothing).
- **Consent expiry (family_manager):** `ConsentManage` managers only; consent must be tenant/profile-scoped, profile active, `consentStatus="active"`, not revoked, `validUntil` present, and the window must match (revoked/suspended/expired/no-validUntil/out-of-window → zero).
- **Boundary:** low-level primitive + resolver still internal (not barrel-exported); source tests prove no domain module imports the kernel, no email/all-members/token path, and the 3 B2 types remain unsupported.
- **Tests:** `family-notifications-recipients-management` (28 DB) + extended source invariants; the full dependent gate stays green (delivery 65/65, recipient-auth 46/46). No migration required.

## Phase 2b-B2 — Family incident & protection-plan visibility authority — IMPLEMENTED & DB-verified
Closes the catalogue: all **13** types now resolve recipients (10 A+B1 + the final 3), all **6** recipient
rules implemented, exhaustive `switch` proven by `never`. Adds one canonical read-only domain authority,
`evaluateFamilyIncidentVisibilityTx(tx, actor, incidentId, now)` in
`packages/db/src/internal/family-incident-visibility.ts`.
- **The rule (single source of truth):** a Family user may know an internal incident *exists* **only when they
  are currently authorized for ≥1 canonical safety signal linked to that incident** — decided *exclusively* by
  looping the canonical `getEffectiveRecipientAuthorization` over the incident's linked signals. **No** reviewer/
  manager/owner role, capability flag, or incident-specific chain ever stands in for signal authorization. Returns
  `{allowed, protectedProfileId, authorizedLinkedSignalIds}` or `{allowed:false, reason}`.
- **Owner-only boundary + transaction strategy:** `child_safety_incidents` / `child_safety_protection_plans` /
  `child_safety_incident_signals` have **0 `tamanor_app` grants** (REVOKE ALL), so the authority reads them via
  **`systemDb` (owner)** with explicit `tenantId` + `workspaceKind` constraints — never `withTenant`. The
  signal-chain reads run inside `getEffectiveRecipientAuthorization`'s own tenant transactions; notification rows
  are written through the passed `tx`. Owner reads and `tamanor_app` writes **cannot** share one transaction, so
  incident-notification rollback atomicity is explicitly a Phase 3 concern (durable-recovery/outbox).
- **Fail-closed reasons:** `incident_not_found` / `workspace_mismatch` / `tenant_mismatch` / `profile_unavailable`
  / `incident_not_family_disclosable` (terminal status) / `no_authorized_linked_signal` / `authorization_ambiguous`
  (linked signals span >1 profile) / `evaluator_error`. The resolver treats `incident_not_family_disclosable`,
  `profile_unavailable`, `no_authorized_linked_signal` as **soft** (→ zero recipients, `ok:true`); missing/
  cross-tenant/ambiguous are **hard** (`ok:false` → `source_not_found` / `authorization_ambiguous` / `resolver_error`).
- **Escalation (`family_incident_escalated`):** identical visibility, plus the persisted incident must actually be
  `escalationState="escalated"`; a non-escalated incident yields zero. Escalation **never broadens** the audience —
  still only currently-authorized guardians.
- **Protection plan (`family_protection_plan_updated`):** disclosed **only** via plan → linked incident → incident
  visibility → linked-signal authorization. Family-disclosable plan state is an **explicit allow-list**
  `{active, reopened}` (NOT `status !== "deleted"`); `draft`/`completed`/`cancelled` → zero. A plan is unique per
  incident. No visibility flag/migration was invented — a non-disclosable state simply fails closed.
- **Privacy:** narrow projections only — no narrative/evidence/reviewer notes/child name/email/token; metadata
  carries no incident/plan id and the safe route has no id; notification content is the bounded catalogue keys.
- **Boundary:** only the high-level `createAuthorizedFamilyNotificationTx` (+ non-tx wrapper) is barrel-exported;
  the resolver, `createFamilyNotificationTx`, and `evaluateFamilyIncidentVisibilityTx` stay internal. Source tests
  prove no domain module imports the internal kernel/visibility authority (index.ts barrel excluded), the authority
  reads owner-only tables via `systemDb` (never `withTenant`), and uses no reviewer/role-capability code shortcut.
- **Tests:** `family-notifications-recipients-incidents` (23 DB) + extended source invariants (27); full gate green
  (delivery 65/65, recipient-auth 46/46, protection-plan 50/50, reviewer 68/68). **0 `tamanor_app` grants** on
  incident/plan re-verified. No migration required.

## Not implemented after Phase 2b (explicit)
- Live signal/incident/delivery/invitation/authority/consent/protection-plan triggers.
- Expiry-evaluator execution / scheduling.
- `/family/notifications`, the shell bell, server actions/forms.
- Push, email, SMS, webhook, external messengers, notification preferences.

## Phase 2b reconciliation — child-safety DELETE-grant regression (fixed)
**Root cause (not a fixture, not a bad runtime row):** the child-safety migrations `REVOKE DELETE, TRUNCATE`
(soft-delete-protected tables) and `REVOKE ALL PRIVILEGES` (owner-only reviewer/incident/policy/evidence tables)
from `tamanor_app`. The provisioning script `set-app-role-password.ts` runs a broad `GRANT … DELETE ON ALL
TABLES` and — when re-run after `migrate deploy` (e.g. a local DB rebuild) — **re-granted DELETE, undoing that
hardening**. The failing assertions were `tamanor_app has … NOT DELETE/TRUNCATE` in `child-safety-delivery` and
`child-safety-recipient-authorization` (the `ssd_ack_consistent`/`ssd_decline_consistent` violations in those runs
are DELIBERATE negative checks that PASS). **Fix:** `set-app-role-password` now re-asserts the child-safety
revokes (kept in sync with the migrations, existence-guarded) after its blanket grant, so re-running it never
re-opens a hole. No constraint was dropped/weakened, no fixture was rewritten, no raw SQL inserted an impossible
state. Verified: delivery 65/65, recipient-auth 46/46, and the full child-safety suite green. Production is
unaffected (it aligns the role password via the `production-app-role-align` workflow, which does NOT run the
blanket grant).

## Known limitation
The runtime `tamanor_app` role retains the blanket table `DELETE` grant from app-role provisioning
(`set-app-role-password`), so "no DELETE on notifications" is enforced at the **service + source-test** layer
(no hard-delete function; dismiss is soft), not by a per-table revoke (which the provisioning would re-grant).
