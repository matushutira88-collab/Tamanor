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
import { WorkspaceKind, type FamilyActorContext } from "@guardora/core";
import { withTenant } from "../repositories";
import { getEffectiveRecipientAuthorization } from "../child-safety-recipient-authorization";
import { evaluateSafetySignalDeliveryEligibility } from "../child-safety-delivery";
import { createFamilyNotificationTx } from "../family-notification-repo";
import type { TenantTx } from "../tenant-db";

// ── Supported source union (typed; never accepts recipients/metadata/severity/route/dedupe) ──────
export type FamilyNotificationAuthorizationSource =
  | { type: "family_signal_available"; safetySignalId: string; eventVersion: string; occurredAt?: Date }
  | { type: "family_urgent_signal"; safetySignalId: string; eventVersion: string; occurredAt?: Date }
  | { type: "family_delivery_available"; deliveryId: string; eventVersion: string; occurredAt?: Date };

export type FamilyNotificationResolutionFailure =
  | "unsupported_type" | "source_not_found" | "workspace_mismatch" | "tenant_mismatch"
  | "profile_mismatch" | "source_state_invalid" | "authorization_ambiguous" | "resolver_error";

export type FamilyNotificationRecipientResolution =
  | { ok: true; notificationType: FamilyNotificationAuthorizationSource["type"]; recipientUserIds: string[] }
  | { ok: false; reason: FamilyNotificationResolutionFailure };

const SUPPORTED = new Set(["family_signal_available", "family_urgent_signal", "family_delivery_available"]);
const EVENT_VERSION_RE = /^[A-Za-z0-9._:-]{1,64}$/;
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

    if (source.type === "family_delivery_available") {
      return await resolveDeliveryRecipient(actor, input.tenantId, source, now);
    }
    return await resolveSignalRecipients(actor, input.tenantId, source, now);
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

  const entityId = "deliveryId" in input.source ? input.source.deliveryId : input.source.safetySignalId;
  const profileId = await sourceProfileId(input.tenantId, input.source);
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

async function sourceProfileId(tenantId: string, source: FamilyNotificationAuthorizationSource): Promise<string | null> {
  if ("deliveryId" in source) {
    const d = await withTenant(tenantId, (db) => db.safetySignalDelivery.findFirst({ where: { id: source.deliveryId, tenantId }, select: { protectedProfileId: true } }));
    return d?.protectedProfileId ?? null;
  }
  const s = await withTenant(tenantId, (db) => db.safetySignal.findFirst({ where: { id: source.safetySignalId, tenantId }, select: { protectedProfileId: true } }));
  return s?.protectedProfileId ?? null;
}
