/**
 * FAMILY NOTIFICATIONS — Phase 2b-A INTERNAL recipient-authorization kernel (signals + delivery ONLY).
 *
 * This module is DELIBERATELY NOT exported from the @guardora/db barrel and MUST NOT be imported by any live
 * domain service, route, action, worker, or maintenance runner in this phase. It exists so a future (Phase 3)
 * trigger layer can resolve recipients + create notifications through a SINGLE authorized entry point without
 * ever constructing recipient user IDs itself. Only the three catalogue types below are supported; every other
 * Family type fails closed (unsupported_type) and creates zero notifications.
 *
 * It COMPOSES the audited canonical evaluators (never reinterprets their rules):
 *   - getEffectiveRecipientAuthorization — the full CS-C4 chain (membership+relationship+authority+consent+
 *     assessment) re-checked LIVE plus a currently-effective persisted decision. One call = the whole chain.
 *   - evaluateSafetySignalDeliveryEligibility — the exact canonical delivery-recipient eligibility.
 * Privacy: only narrow id/status projections are read; no content/name/age/email/note/token is ever loaded,
 * returned, logged, or thrown. Recipient IDs are internal and are NEVER returned to browser-facing callers.
 */
import { WorkspaceKind, FamilyAction, familyRoleCan, familyRoleForMembershipRole, familyExpiryWindow, familyDaysUntil, type FamilyActorContext } from "@guardora/core";
import { withTenant } from "../repositories";
import { systemDb } from "../index";
import { getEffectiveRecipientAuthorization } from "../child-safety-recipient-authorization";
import { evaluateSafetySignalDeliveryEligibility } from "../child-safety-delivery";
import { createFamilyNotificationTx } from "../family-notification-repo";
import { resolveIncidentRecipientUserIds, loadFamilyDisclosablePlan, type FamilyIncidentVisibilityReason } from "./family-incident-visibility";
import type { TenantTx } from "../tenant-db";

// ── Supported source union (typed; never accepts recipients/metadata/severity/route/dedupe) ──────
export type ExpiryWindow = "7d" | "1d";
export type FamilyNotificationAuthorizationSource =
  // Phase 2b-A (signals + delivery available)
  | { type: "family_signal_available"; safetySignalId: string; eventVersion: string; occurredAt?: Date }
  | { type: "family_urgent_signal"; safetySignalId: string; eventVersion: string; occurredAt?: Date }
  | { type: "family_delivery_available"; deliveryId: string; eventVersion: string; occurredAt?: Date }
  // Phase 2b-B1 (managers, invitations, affected guardian)
  | { type: "family_delivery_acknowledged" | "family_delivery_declined"; deliveryId: string; eventVersion: string; occurredAt?: Date }
  | { type: "family_guardian_invitation_accepted"; invitationId: string; eventVersion: string; occurredAt?: Date }
  | { type: "family_guardian_invitation_expiring"; invitationId: string; expiryWindow: ExpiryWindow; eventVersion: string; occurredAt?: Date }
  | { type: "family_authority_changed"; guardianAuthorityRecordId: string; eventVersion: string; occurredAt?: Date }
  | { type: "family_consent_expiring"; consentRecordId: string; expiryWindow: ExpiryWindow; eventVersion: string; occurredAt?: Date }
  | { type: "family_recipient_authorization_changed"; authorizationDecisionId: string; eventVersion: string; occurredAt?: Date }
  // Phase 2b-B2 (incident + protection-plan visibility — owner-only source boundary)
  | { type: "family_incident_created" | "family_incident_escalated"; incidentId: string; eventVersion: string; occurredAt?: Date }
  | { type: "family_protection_plan_updated"; protectionPlanId: string; eventVersion: string; occurredAt?: Date };

export type FamilyNotificationResolutionFailure =
  | "unsupported_type" | "source_not_found" | "workspace_mismatch" | "tenant_mismatch"
  | "profile_mismatch" | "source_state_invalid" | "authorization_ambiguous" | "resolver_error";

export type FamilyNotificationRecipientResolution =
  | { ok: true; notificationType: FamilyNotificationAuthorizationSource["type"]; recipientUserIds: string[] }
  | { ok: false; reason: FamilyNotificationResolutionFailure };

const SUPPORTED = new Set([
  "family_signal_available", "family_urgent_signal", "family_delivery_available",
  "family_delivery_acknowledged", "family_delivery_declined",
  "family_guardian_invitation_accepted", "family_guardian_invitation_expiring",
  "family_authority_changed", "family_consent_expiring", "family_recipient_authorization_changed",
  "family_incident_created", "family_incident_escalated", "family_protection_plan_updated",
]); // ALL 13 catalogue types are now supported.
const EVENT_VERSION_RE = /^[A-Za-z0-9._:-]{1,64}$/;
/** Catalogue type → the exact canonical Family MANAGER action (fail-closed; no role-name shortcuts). */
const MANAGER_ACTION: Record<string, FamilyAction> = {
  family_delivery_acknowledged: FamilyAction.SafetyDeliveryView,
  family_delivery_declined: FamilyAction.SafetyDeliveryView,
  family_guardian_invitation_accepted: FamilyAction.FamilyInvitationView,
  family_guardian_invitation_expiring: FamilyAction.FamilyInvitationView,
  family_authority_changed: FamilyAction.GuardianAuthorityManage,
  family_consent_expiring: FamilyAction.ConsentManage,
  family_recipient_authorization_changed: FamilyAction.SafetyRecipientAuthorizationView,
};
const URGENT_SEVERITIES = new Set(["high", "critical"]);
const ACTIVE_PROFILE_STATUSES = new Set(["monitoring", "active", "paused"]); // not "inactive"; archivedAt handled separately

/** Trusted system evaluator actor for the verified tenant (owner → PrimaryGuardian → full read/evaluate). Its
 *  userId is never used by the read-only canonical evaluators; RLS is tenant-scoped. */
function resolverActor(tenantId: string): FamilyActorContext {
  return { tenantId, userId: `system:family-notification-resolver`, role: "owner", workspaceKind: WorkspaceKind.Family };
}

function validEventVersion(v: unknown): v is string {
  return typeof v === "string" && EVENT_VERSION_RE.test(v);
}

/**
 * Resolve the unique, deterministically-ordered, active recipient user IDs for a supported Family notification
 * source. Fail-closed: unknown type, missing/cross-tenant source, non-family workspace, profile mismatch,
 * invalid lifecycle, or any unexpected evaluator/DB error → ok:false with ZERO recipients. Normal ineligibility
 * (a candidate not currently authorized) simply excludes that candidate; other eligible candidates still return.
 */
export async function resolveFamilyNotificationRecipientsTx(
  _tx: TenantTx,
  input: { tenantId: string; source: FamilyNotificationAuthorizationSource; now?: Date },
): Promise<FamilyNotificationRecipientResolution> {
  const now = input.now ?? new Date();
  const { source } = input;
  if (!source || !SUPPORTED.has(source.type)) return { ok: false, reason: "unsupported_type" };
  if (!validEventVersion(source.eventVersion)) return { ok: false, reason: "source_state_invalid" };
  const actor = resolverActor(input.tenantId);

  try {
    // Common: the tenant must be a FAMILY workspace (fail-closed, non-enumerating).
    const tenant = await withTenant(input.tenantId, (db) => db.tenant.findFirst({ where: { id: input.tenantId }, select: { workspaceKind: true } }));
    if (!tenant) return { ok: false, reason: "tenant_mismatch" };
    if (tenant.workspaceKind !== WorkspaceKind.Family) return { ok: false, reason: "workspace_mismatch" };

    switch (source.type) {
      case "family_signal_available":
      case "family_urgent_signal":
        return await resolveSignalRecipients(actor, input.tenantId, source, now);
      case "family_delivery_available":
        return await resolveDeliveryRecipient(actor, input.tenantId, source, now);
      case "family_delivery_acknowledged":
      case "family_delivery_declined":
        return await resolveDeliveryOutcomeRecipients(input.tenantId, source, now);
      case "family_guardian_invitation_accepted":
      case "family_guardian_invitation_expiring":
        return await resolveInvitationRecipients(input.tenantId, source, now);
      case "family_authority_changed":
        return await resolveAuthorityChangeRecipients(input.tenantId, source, now);
      case "family_recipient_authorization_changed":
        return await resolveRecipientAuthorizationChangeRecipients(input.tenantId, source, now);
      case "family_consent_expiring":
        return await resolveConsentExpiringRecipients(input.tenantId, source, now);
      case "family_incident_created":
      case "family_incident_escalated":
        return await resolveIncidentRecipients(input.tenantId, source, now);
      case "family_protection_plan_updated":
        return await resolveProtectionPlanRecipients(input.tenantId, source, now);
      default: {
        // Exhaustiveness: any unhandled (incl. the 3 deferred B2 types) fails closed. `never` proves it.
        const _exhaustive: never = source;
        void _exhaustive;
        return { ok: false, reason: "unsupported_type" };
      }
    }
  } catch {
    // Never leak a raw evaluator/DB error; an unexpected failure is fail-closed.
    return { ok: false, reason: "resolver_error" };
  }
}

async function resolveSignalRecipients(
  actor: FamilyActorContext, tenantId: string,
  source: Extract<FamilyNotificationAuthorizationSource, { safetySignalId: string }>, now: Date,
): Promise<FamilyNotificationRecipientResolution> {
  // Load the signal (RLS tenant-scoped → a cross-tenant id is simply not found).
  const signal = await withTenant(tenantId, (db) => db.safetySignal.findFirst({
    where: { id: source.safetySignalId, tenantId }, select: { id: true, protectedProfileId: true, severity: true, archivedAt: true },
  }));
  if (!signal) return { ok: false, reason: "source_not_found" };
  if (signal.archivedAt) return { ok: false, reason: "source_state_invalid" };
  // Urgent notification requires the persisted severity to actually be urgent — a caller cannot promote a
  // normal signal by choosing the urgent type.
  if (source.type === "family_urgent_signal" && !URGENT_SEVERITIES.has(String(signal.severity))) {
    return { ok: false, reason: "source_state_invalid" };
  }

  // Profile scope: must exist, same tenant, active, not archived.
  const profile = await withTenant(tenantId, (db) => db.protectedProfile.findFirst({
    where: { id: signal.protectedProfileId, tenantId }, select: { id: true, protectionStatus: true, archivedAt: true },
  }));
  if (!profile) return { ok: false, reason: "profile_mismatch" };
  if (profile.archivedAt || !ACTIVE_PROFILE_STATUSES.has(String(profile.protectionStatus))) return { ok: true, notificationType: source.type, recipientUserIds: [] };

  // Candidate discovery: ACTIVE guardian relationships for THIS profile only (never all members).
  const relationships = await withTenant(tenantId, (db) => db.guardianRelationship.findMany({
    where: { tenantId, protectedProfileId: signal.protectedProfileId, status: "verified", revokedAt: null, archivedAt: null },
    select: { id: true, guardianMembershipId: true },
  }));

  const eligibleMembershipIds: string[] = [];
  for (const rel of relationships) {
    // The whole CS-C4 chain (live) + a currently-effective persisted decision, for THIS signal + membership.
    const effective = await getEffectiveRecipientAuthorization(actor, signal.id, rel.guardianMembershipId, now);
    if (effective) eligibleMembershipIds.push(rel.guardianMembershipId);
  }
  const recipientUserIds = await membershipUserIds(tenantId, eligibleMembershipIds);
  return { ok: true, notificationType: source.type, recipientUserIds };
}

async function resolveDeliveryRecipient(
  actor: FamilyActorContext, tenantId: string,
  source: Extract<FamilyNotificationAuthorizationSource, { deliveryId: string }>, now: Date,
): Promise<FamilyNotificationRecipientResolution> {
  const delivery = await withTenant(tenantId, (db) => db.safetySignalDelivery.findFirst({
    where: { id: source.deliveryId, tenantId },
    select: { id: true, tenantId: true, safetySignalId: true, protectedProfileId: true, recipientAuthorizationDecisionId: true, recipientMembershipId: true, deliveryStatus: true },
  }));
  if (!delivery) return { ok: false, reason: "source_not_found" };
  // Only an AVAILABLE delivery (awaiting recipient action) is meaningful; acknowledged/declined/revoked/etc → none.
  if (delivery.deliveryStatus !== "available") return { ok: true, notificationType: source.type, recipientUserIds: [] };
  if (!delivery.recipientMembershipId || !delivery.recipientAuthorizationDecisionId) return { ok: false, reason: "source_state_invalid" };

  // Canonical delivery eligibility (re-checks the effective recipient authorization + live CS-C4 chain).
  const eligibility = await evaluateSafetySignalDeliveryEligibility(actor, { recipientAuthorizationDecisionId: delivery.recipientAuthorizationDecisionId }, now);
  if (!eligibility.eligible) return { ok: true, notificationType: source.type, recipientUserIds: [] };
  // The recipient membership comes ONLY from the canonical delivery/decision row, never a caller value.
  if (eligibility.recipientMembershipId !== delivery.recipientMembershipId) return { ok: false, reason: "authorization_ambiguous" };

  const recipientUserIds = await membershipUserIds(tenantId, [delivery.recipientMembershipId]);
  return { ok: true, notificationType: source.type, recipientUserIds };
}

// ── Shared helpers for the B1 rules ─────────────────────────────────────────────
/** null = profile not found (fail-closed); boolean = active (monitoring/active/paused, not archived). */
async function isProfileActive(tenantId: string, profileId: string): Promise<boolean | null> {
  const p = await withTenant(tenantId, (db) => db.protectedProfile.findFirst({ where: { id: profileId, tenantId }, select: { protectionStatus: true, archivedAt: true } }));
  if (!p) return null;
  return !p.archivedAt && ACTIVE_PROFILE_STATUSES.has(String(p.protectionStatus));
}

/**
 * Active Family users who hold the EXACT canonical Family action (via the pure role→action authority — never a
 * raw role-name comparison, never an "all admins/owner" shortcut). Membership existence = active. Unique + sorted.
 */
async function resolveAuthorizedFamilyManagersTx(tenantId: string, action: FamilyAction): Promise<string[]> {
  const members = await withTenant(tenantId, (db) => db.membership.findMany({ where: { tenantId }, select: { userId: true, role: true } }));
  const ids = members.filter((m) => familyRoleCan(familyRoleForMembershipRole(m.role), action)).map((m) => m.userId);
  return [...new Set(ids)].sort();
}

/** Match a whole-day-count to the requested expiry window ("7d" for 1<d<=7; "1d" for d<=1). */
function expiryWindowMatches(daysRemaining: number | null, requested: ExpiryWindow): boolean {
  if (daysRemaining == null) return false;
  const w = familyExpiryWindow(daysRemaining);
  return (w === 7 && requested === "7d") || (w === 1 && requested === "1d");
}

const ok = (notificationType: FamilyNotificationAuthorizationSource["type"], recipientUserIds: string[]): FamilyNotificationRecipientResolution => ({ ok: true, notificationType, recipientUserIds: [...new Set(recipientUserIds)].sort() });

// ── family_manager: delivery outcome (acknowledged / declined) ──
async function resolveDeliveryOutcomeRecipients(tenantId: string, source: Extract<FamilyNotificationAuthorizationSource, { type: "family_delivery_acknowledged" | "family_delivery_declined" }>, _now: Date): Promise<FamilyNotificationRecipientResolution> {
  const d = await withTenant(tenantId, (db) => db.safetySignalDelivery.findFirst({ where: { id: source.deliveryId, tenantId }, select: { id: true, protectedProfileId: true, deliveryStatus: true } }));
  if (!d) return { ok: false, reason: "source_not_found" };
  const active = await isProfileActive(tenantId, d.protectedProfileId);
  if (active === null) return { ok: false, reason: "profile_mismatch" };
  const required = source.type === "family_delivery_acknowledged" ? "acknowledged" : "declined";
  // A caller cannot notify an outcome the delivery is not actually in → zero recipients (not an error).
  if (!active || d.deliveryStatus !== required) return ok(source.type, []);
  return ok(source.type, await resolveAuthorizedFamilyManagersTx(tenantId, MANAGER_ACTION[source.type]!));
}

// ── inviter_plus_admins: guardian invitation (accepted / expiring) ──
async function resolveInvitationRecipients(tenantId: string, source: Extract<FamilyNotificationAuthorizationSource, { invitationId: string }>, now: Date): Promise<FamilyNotificationRecipientResolution> {
  // NARROW projection — never selects invitedEmailNormalized or tokenHash.
  const inv = await withTenant(tenantId, (db) => db.familyGuardianInvitation.findFirst({ where: { id: source.invitationId, tenantId }, select: { id: true, invitedByMembershipId: true, status: true, acceptedAt: true, expiresAt: true } }));
  if (!inv) return { ok: false, reason: "source_not_found" };
  if (source.type === "family_guardian_invitation_accepted") {
    if (inv.status !== "accepted" || !inv.acceptedAt) return ok(source.type, []);
  } else {
    if (inv.status !== "pending" || !inv.expiresAt) return ok(source.type, []);
    if (!expiryWindowMatches(familyDaysUntil(inv.expiresAt, now), source.expiryWindow)) return ok(source.type, []);
  }
  const inviter = await membershipUserIds(tenantId, [inv.invitedByMembershipId]);
  const managers = await resolveAuthorizedFamilyManagersTx(tenantId, FamilyAction.FamilyInvitationView);
  return ok(source.type, [...inviter, ...managers]);
}

// ── affected_guardian_plus_managers: authority change ──
async function resolveAuthorityChangeRecipients(tenantId: string, source: Extract<FamilyNotificationAuthorizationSource, { guardianAuthorityRecordId: string }>, _now: Date): Promise<FamilyNotificationRecipientResolution> {
  const auth = await withTenant(tenantId, (db) => db.guardianAuthorityRecord.findFirst({ where: { id: source.guardianAuthorityRecordId, tenantId }, select: { id: true, guardianRelationshipId: true } }));
  if (!auth) return { ok: false, reason: "source_not_found" };
  const rel = await withTenant(tenantId, (db) => db.guardianRelationship.findFirst({ where: { id: auth.guardianRelationshipId, tenantId }, select: { guardianMembershipId: true, protectedProfileId: true } }));
  if (!rel) return { ok: false, reason: "authorization_ambiguous" };
  // Affected guardian gets a NEUTRAL own-status notification (content-free; the /admin-style CTA re-guards access).
  const affected = await membershipUserIds(tenantId, [rel.guardianMembershipId]);
  const managers = await resolveAuthorizedFamilyManagersTx(tenantId, FamilyAction.GuardianAuthorityManage);
  return ok(source.type, [...affected, ...managers]);
}

// ── affected_guardian_plus_managers: recipient-authorization change ──
async function resolveRecipientAuthorizationChangeRecipients(tenantId: string, source: Extract<FamilyNotificationAuthorizationSource, { authorizationDecisionId: string }>, _now: Date): Promise<FamilyNotificationRecipientResolution> {
  const dec = await withTenant(tenantId, (db) => db.safetyRecipientAuthorizationDecision.findFirst({ where: { id: source.authorizationDecisionId, tenantId }, select: { id: true, recipientMembershipId: true } }));
  if (!dec) return { ok: false, reason: "source_not_found" };
  const affected = await membershipUserIds(tenantId, [dec.recipientMembershipId]);
  const managers = await resolveAuthorizedFamilyManagersTx(tenantId, FamilyAction.SafetyRecipientAuthorizationView);
  return ok(source.type, [...affected, ...managers]);
}

// ── family_manager: consent approaching expiry ──
async function resolveConsentExpiringRecipients(tenantId: string, source: Extract<FamilyNotificationAuthorizationSource, { consentRecordId: string }>, now: Date): Promise<FamilyNotificationRecipientResolution> {
  const c = await withTenant(tenantId, (db) => db.consentRecord.findFirst({ where: { id: source.consentRecordId, tenantId }, select: { id: true, protectedProfileId: true, consentStatus: true, validUntil: true, revokedAt: true } }));
  if (!c) return { ok: false, reason: "source_not_found" };
  const active = await isProfileActive(tenantId, c.protectedProfileId);
  if (active === null) return { ok: false, reason: "profile_mismatch" };
  const effective = c.consentStatus === "active" && !c.revokedAt && c.validUntil != null;
  if (!active || !effective) return ok(source.type, []);
  if (!expiryWindowMatches(familyDaysUntil(c.validUntil, now), source.expiryWindow)) return ok(source.type, []);
  return ok(source.type, await resolveAuthorizedFamilyManagersTx(tenantId, FamilyAction.ConsentManage));
}

// ── cs_authorized_recipient (incidents) + protection_plan_viewer (Phase 2b-B2) ──
function mapIncidentReason(reason: FamilyIncidentVisibilityReason): FamilyNotificationResolutionFailure {
  switch (reason) {
    case "incident_not_found": return "source_not_found";
    case "workspace_mismatch": return "workspace_mismatch";
    case "tenant_mismatch": return "tenant_mismatch";
    case "authorization_ambiguous": return "authorization_ambiguous";
    default: return "resolver_error";
  }
}

async function resolveIncidentRecipients(tenantId: string, source: Extract<FamilyNotificationAuthorizationSource, { incidentId: string }>, now: Date): Promise<FamilyNotificationRecipientResolution> {
  const r = await resolveIncidentRecipientUserIds(tenantId, source.incidentId, now, source.type === "family_incident_escalated");
  return r.ok ? ok(source.type, r.userIds) : { ok: false, reason: mapIncidentReason(r.reason) };
}

async function resolveProtectionPlanRecipients(tenantId: string, source: Extract<FamilyNotificationAuthorizationSource, { protectionPlanId: string }>, now: Date): Promise<FamilyNotificationRecipientResolution> {
  const plan = await loadFamilyDisclosablePlan(tenantId, source.protectionPlanId);
  if (!plan.ok) return { ok: false, reason: "source_not_found" };
  if (!plan.disclosable) return ok(source.type, []); // not a Family-disclosable plan state → zero recipients
  const r = await resolveIncidentRecipientUserIds(tenantId, plan.incidentId, now, false);
  return r.ok ? ok(source.type, r.userIds) : { ok: false, reason: mapIncidentReason(r.reason) };
}

/** Resolve ACTIVE users behind the given membership ids (same tenant). Unique + deterministically sorted. */
async function membershipUserIds(tenantId: string, membershipIds: string[]): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await withTenant(tenantId, (db) => db.membership.findMany({
    where: { id: { in: [...new Set(membershipIds)] }, tenantId, user: { is: {} } },
    select: { userId: true },
  }));
  return [...new Set(rows.map((r) => r.userId).filter((u): u is string => typeof u === "string" && u.length > 0))].sort();
}

// ── High-level AUTHORIZED creation (internal; the future public trigger entry point) ────────────
export type AuthorizedFamilyNotificationCreationResult =
  | { ok: true; eligibleRecipientCount: number; createdCount: number; duplicateCount: number }
  | { ok: false; reason: FamilyNotificationResolutionFailure };

/**
 * Resolve recipients (authorization boundary) THEN persist one Family notification per authorized recipient, all
 * inside the caller's transaction `tx`. Zero eligible recipients → ok with zero rows. Resolver failure → ok:false
 * and ZERO rows. Recipient IDs are NEVER returned. Metadata/severity/title/route/dedupe are catalogue-derived by
 * the persistence primitive; the caller supplies none of them.
 */
export async function createAuthorizedFamilyNotificationTx(
  tx: TenantTx,
  input: { tenantId: string; source: FamilyNotificationAuthorizationSource; safeReasonCode?: string | null; now?: Date },
): Promise<AuthorizedFamilyNotificationCreationResult> {
  const now = input.now ?? new Date();
  const resolution = await resolveFamilyNotificationRecipientsTx(tx, { tenantId: input.tenantId, source: input.source, now });
  if (!resolution.ok) return { ok: false, reason: resolution.reason };

  const s = input.source;
  const entityId = "deliveryId" in s ? s.deliveryId
    : "invitationId" in s ? s.invitationId
    : "guardianAuthorityRecordId" in s ? s.guardianAuthorityRecordId
    : "consentRecordId" in s ? s.consentRecordId
    : "authorizationDecisionId" in s ? s.authorizationDecisionId
    : "incidentId" in s ? s.incidentId
    : "protectionPlanId" in s ? s.protectionPlanId
    : s.safetySignalId;
  const profileId = await sourceProfileId(input.tenantId, s);
  const created = await createFamilyNotificationTx(tx, {
    tenantId: input.tenantId,
    type: input.source.type,
    entityId,
    profileId,
    eventVersion: input.source.eventVersion,
    safeReasonCode: input.safeReasonCode ?? null,
    occurredAt: input.source.occurredAt ?? null,
    recipientUserIds: resolution.recipientUserIds,
  });
  return { ok: true, eligibleRecipientCount: resolution.recipientUserIds.length, createdCount: created.created, duplicateCount: created.recipients - created.created };
}

/** Non-transactional convenience: opens a tenant-scoped transaction and creates. This is the SUPPORTED public
 *  trigger-facing entry point (the resolver + low-level primitive stay internal). */
export async function createAuthorizedFamilyNotification(input: { tenantId: string; source: FamilyNotificationAuthorizationSource; safeReasonCode?: string | null; now?: Date }): Promise<AuthorizedFamilyNotificationCreationResult> {
  return withTenant(input.tenantId, (tx) => createAuthorizedFamilyNotificationTx(tx, input));
}

/** Best-effort bounded profileId for metadata (optional). Invitations are workspace-level → null. */
async function sourceProfileId(tenantId: string, source: FamilyNotificationAuthorizationSource): Promise<string | null> {
  if ("safetySignalId" in source) return (await withTenant(tenantId, (db) => db.safetySignal.findFirst({ where: { id: source.safetySignalId, tenantId }, select: { protectedProfileId: true } })))?.protectedProfileId ?? null;
  if ("deliveryId" in source) return (await withTenant(tenantId, (db) => db.safetySignalDelivery.findFirst({ where: { id: source.deliveryId, tenantId }, select: { protectedProfileId: true } })))?.protectedProfileId ?? null;
  if ("consentRecordId" in source) return (await withTenant(tenantId, (db) => db.consentRecord.findFirst({ where: { id: source.consentRecordId, tenantId }, select: { protectedProfileId: true } })))?.protectedProfileId ?? null;
  if ("authorizationDecisionId" in source) return (await withTenant(tenantId, (db) => db.safetyRecipientAuthorizationDecision.findFirst({ where: { id: source.authorizationDecisionId, tenantId }, select: { protectedProfileId: true } })))?.protectedProfileId ?? null;
  if ("guardianAuthorityRecordId" in source) {
    const auth = await withTenant(tenantId, (db) => db.guardianAuthorityRecord.findFirst({ where: { id: source.guardianAuthorityRecordId, tenantId }, select: { guardianRelationshipId: true } }));
    if (!auth) return null;
    return (await withTenant(tenantId, (db) => db.guardianRelationship.findFirst({ where: { id: auth.guardianRelationshipId, tenantId }, select: { protectedProfileId: true } })))?.protectedProfileId ?? null;
  }
  // Owner-only source tables (incident / protection plan) → read via the owner client, tenant-constrained.
  if ("incidentId" in source) return (await systemDb.childSafetyIncident.findFirst({ where: { id: source.incidentId, tenantId }, select: { protectedProfileId: true } }))?.protectedProfileId ?? null;
  if ("protectionPlanId" in source) {
    const plan = await systemDb.childSafetyProtectionPlan.findFirst({ where: { id: source.protectionPlanId, tenantId }, select: { incidentId: true } });
    if (!plan) return null;
    return (await systemDb.childSafetyIncident.findFirst({ where: { id: plan.incidentId, tenantId }, select: { protectedProfileId: true } }))?.protectedProfileId ?? null;
  }
  return null; // invitationId — workspace-level, no single profile
}
