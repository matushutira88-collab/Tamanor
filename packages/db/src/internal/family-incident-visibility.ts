/**
 * FAMILY NOTIFICATIONS — Phase 2b-B2 INTERNAL Family incident-visibility authority (owner-only source boundary).
 *
 * Incident + protection-plan tables are OWNER-ONLY (REVOKE ALL FROM tamanor_app), so they are read here through
 * the OWNER client (`systemDb`) with EVERY read explicitly constrained by the trusted `tenantId` (systemDb
 * bypasses RLS, so the explicit tenant filter IS the tenant boundary). No tamanor_app grant is added; the app
 * role never touches these tables. NOT barrel-exported (internal to the notification kernel).
 *
 * A Family user may know an internal incident exists ONLY when they are currently authorized for ≥1 canonical
 * safety signal linked to that incident — the SAME live CS-C4 chain used by family_signal_available (reused via
 * getEffectiveRecipientAuthorization, never a weaker incident-specific chain). Manager/owner/reviewer role alone
 * is insufficient. The result carries only bounded operational identifiers — never narrative/evidence/notes.
 */
import { WorkspaceKind, CHILD_SAFETY_TERMINAL_INCIDENT_STATUSES, type FamilyActorContext } from "@guardora/core";
import { systemDb } from "../index";
import { getEffectiveRecipientAuthorization } from "../child-safety-recipient-authorization";

const TERMINAL_INCIDENT = new Set(CHILD_SAFETY_TERMINAL_INCIDENT_STATUSES.map(String));
const ACTIVE_PROFILE = new Set(["monitoring", "active", "paused"]);
/** Protection-plan states in which the EXISTENCE of a plan may be disclosed to an authorized Family user.
 *  Deliberately NOT `status !== "deleted"`: only genuinely activated plans. Draft (internal drafting),
 *  completed, and cancelled are NOT Family-disclosable. */
export const FAMILY_DISCLOSABLE_PLAN_STATES = new Set(["active", "reopened"]);

export type FamilyIncidentVisibilityReason =
  | "incident_not_found" | "workspace_mismatch" | "tenant_mismatch" | "profile_unavailable"
  | "incident_not_family_disclosable" | "no_authorized_linked_signal" | "authorization_ambiguous" | "evaluator_error";
export type FamilyIncidentVisibilityDecision =
  | { allowed: true; protectedProfileId: string; authorizedLinkedSignalIds: string[] }
  | { allowed: false; reason: FamilyIncidentVisibilityReason };

interface IncidentContext { profileId: string; linkedSignalIds: string[]; escalated: boolean }
type ContextResult = { ok: true; ctx: IncidentContext } | { ok: false; reason: FamilyIncidentVisibilityReason };

/** Owner-scoped, tenant-constrained incident validation → its profile + ACTIVE linked signals + escalation flag. */
async function loadFamilyIncidentContext(tenantId: string, incidentId: string): Promise<ContextResult> {
  const inc = await systemDb.childSafetyIncident.findFirst({ where: { id: incidentId, tenantId }, select: { protectedProfileId: true, status: true, escalationState: true } });
  if (!inc) return { ok: false, reason: "incident_not_found" };
  if (TERMINAL_INCIDENT.has(String(inc.status))) return { ok: false, reason: "incident_not_family_disclosable" };
  const prof = await systemDb.protectedProfile.findFirst({ where: { id: inc.protectedProfileId, tenantId }, select: { protectionStatus: true, archivedAt: true } });
  if (!prof || prof.archivedAt || !ACTIVE_PROFILE.has(String(prof.protectionStatus))) return { ok: false, reason: "profile_unavailable" };
  const links = await systemDb.childSafetyIncidentSignal.findMany({ where: { incidentId, tenantId }, select: { safetySignalId: true } });
  if (links.length === 0) return { ok: false, reason: "no_authorized_linked_signal" };
  const signalIds = links.map((l) => l.safetySignalId);
  const signals = await systemDb.safetySignal.findMany({ where: { id: { in: signalIds }, tenantId }, select: { id: true, protectedProfileId: true, archivedAt: true } });
  if (signals.length !== signalIds.length) return { ok: false, reason: "authorization_ambiguous" };            // a linked signal missing / cross-tenant
  if (signals.some((s) => s.protectedProfileId !== inc.protectedProfileId)) return { ok: false, reason: "authorization_ambiguous" }; // multi-profile
  const activeSignalIds = signals.filter((s) => !s.archivedAt).map((s) => s.id);
  if (activeSignalIds.length === 0) return { ok: false, reason: "no_authorized_linked_signal" };
  return { ok: true, ctx: { profileId: inc.protectedProfileId, linkedSignalIds: activeSignalIds, escalated: inc.escalationState === "escalated" } };
}

function sysActor(tenantId: string): FamilyActorContext {
  return { tenantId, userId: "system:family-incident-visibility", role: "owner", workspaceKind: WorkspaceKind.Family };
}

/** Linked signals a given membership is CURRENTLY authorized for (live CS-C4 chain via getEffectiveRecipientAuthorization). */
async function authorizedLinkedSignals(tenantId: string, signalIds: string[], membershipId: string, now: Date): Promise<string[]> {
  const actor = sysActor(tenantId);
  const out: string[] = [];
  for (const sid of signalIds) { if (await getEffectiveRecipientAuthorization(actor, sid, membershipId, now)) out.push(sid); }
  return out;
}

/**
 * The canonical per-ACTOR authority: may this Family actor currently know that the incident exists? Fail-closed,
 * bounded reasons only, no raw incident fields. (`_tx` is accepted for signature symmetry; owner-only tables must
 * be read through the owner client, so the actual reads use `systemDb` with explicit tenant constraints.)
 */
export async function evaluateFamilyIncidentVisibilityTx(_tx: unknown, actor: FamilyActorContext, incidentId: string, now: Date = new Date()): Promise<FamilyIncidentVisibilityDecision> {
  if (actor.workspaceKind !== WorkspaceKind.Family) return { allowed: false, reason: "workspace_mismatch" };
  try {
    const ctx = await loadFamilyIncidentContext(actor.tenantId, incidentId);
    if (!ctx.ok) return { allowed: false, reason: ctx.reason };
    const membership = await systemDb.membership.findFirst({ where: { userId: actor.userId, tenantId: actor.tenantId }, select: { id: true } });
    if (!membership) return { allowed: false, reason: "no_authorized_linked_signal" };
    const authorized = await authorizedLinkedSignals(actor.tenantId, ctx.ctx.linkedSignalIds, membership.id, now);
    if (authorized.length === 0) return { allowed: false, reason: "no_authorized_linked_signal" };
    return { allowed: true, protectedProfileId: ctx.ctx.profileId, authorizedLinkedSignalIds: authorized };
  } catch {
    return { allowed: false, reason: "evaluator_error" };
  }
}

export type IncidentRecipientResult =
  | { ok: true; userIds: string[] }
  | { ok: false; reason: FamilyIncidentVisibilityReason };

// SOFT denials (no one to notify, but not an error): a non-disclosable/inactive/no-linked-signal incident.
// HARD failures (fail-closed with an error): not found, ambiguous/contradictory links, evaluator/DB error.
const SOFT_REASONS = new Set<FamilyIncidentVisibilityReason>(["incident_not_family_disclosable", "profile_unavailable", "no_authorized_linked_signal"]);

/**
 * All eligible recipient user IDs for an incident: candidate discovery from ACTIVE guardian relationships for the
 * incident's profile ONLY (never all members), each gated on current authorization for ≥1 linked signal.
 * `requireEscalated` returns zero recipients when the incident is not persisted-escalated (a caller cannot forge
 * escalation by choosing the escalated type). Soft denials → zero recipients; hard failures → ok:false.
 */
export async function resolveIncidentRecipientUserIds(tenantId: string, incidentId: string, now: Date, requireEscalated: boolean): Promise<IncidentRecipientResult> {
  try {
    const ctx = await loadFamilyIncidentContext(tenantId, incidentId);
    if (!ctx.ok) return SOFT_REASONS.has(ctx.reason) ? { ok: true, userIds: [] } : { ok: false, reason: ctx.reason };
    if (requireEscalated && !ctx.ctx.escalated) return { ok: true, userIds: [] };
    const rels = await systemDb.guardianRelationship.findMany({ where: { tenantId, protectedProfileId: ctx.ctx.profileId, status: "verified", revokedAt: null, archivedAt: null }, select: { guardianMembershipId: true } });
    const eligible: string[] = [];
    for (const rel of rels) {
      if ((await authorizedLinkedSignals(tenantId, ctx.ctx.linkedSignalIds, rel.guardianMembershipId, now)).length > 0) eligible.push(rel.guardianMembershipId);
    }
    if (eligible.length === 0) return { ok: true, userIds: [] };
    const users = await systemDb.membership.findMany({ where: { id: { in: [...new Set(eligible)] }, tenantId }, select: { userId: true } });
    return { ok: true, userIds: [...new Set(users.map((u) => u.userId))].sort() };
  } catch {
    return { ok: false, reason: "evaluator_error" };
  }
}

/** A protection plan's linked incident id + whether its state is Family-disclosable (owner-scoped read). */
export async function loadFamilyDisclosablePlan(tenantId: string, protectionPlanId: string): Promise<{ ok: true; incidentId: string; disclosable: boolean } | { ok: false }> {
  const plan = await systemDb.childSafetyProtectionPlan.findFirst({ where: { id: protectionPlanId, tenantId }, select: { incidentId: true, status: true } });
  if (!plan) return { ok: false };
  return { ok: true, incidentId: plan.incidentId, disclosable: FAMILY_DISCLOSABLE_PLAN_STATES.has(String(plan.status)) };
}
