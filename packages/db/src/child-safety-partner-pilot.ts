/**
 * Child Safety Partner Pilot & Integration Operations V1 — the SYSTEM-scoped operational service layer
 * (systemDb). Turns the completed Integration Signal Protocol into a controlled, auditable, tenant-isolated
 * partner-onboarding + pilot lifecycle: a deterministic server-side state machine (no client-selected
 * status; optimistic concurrency via `version`), readiness evaluation (advisory — never auto-activates),
 * content-free compatibility test runs, operational contacts, content-free operational alerts, and the
 * production-gateway pilot enforcement gate.
 *
 * Privacy by construction: NO raw content, credentials, private keys, full signatures, child identities, or
 * guardian data are ever accepted or stored — only bounded operational metadata and server-approved scope
 * BANDS. Every function is tenant-isolated (SYSTEM tables via systemDb with explicit scoping + composite
 * (id, tenantId) FKs). Server-internal defensive thresholds live ONLY here (never in a client bundle).
 */
import { createHash, generateKeyPairSync, sign as edSign, randomUUID } from "node:crypto";
import { ActorKind } from "@prisma/client";
import {
  Role,
  buildSigningString, CHILD_SAFETY_SIGNAL_PROTOCOL, CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION,
  PILOT_CHECK_TYPES, PILOT_STATUSES, PILOT_ACTIONS, PILOT_CONTACT_ROLES, PILOT_VOLUME_BANDS, PILOT_RATE_BANDS,
  PILOT_ASSESSMENT_STATUSES, PILOT_SUSPENSION_REASON_CODES, PILOT_TERMINATION_REASON_CODES,
  PILOT_ALERT_TYPES, PILOT_ALERT_SEVERITIES, PARTNER_RISK_TYPES, PARTNER_AGE_BANDS, INTEGRATION_CAPABILITIES,
  canTransitionPilot, isTerminalPilotStatus, isNonWaivableCheck, isSafeBoundedNote,
  evaluatePilotReadiness, type ReadinessResult, type PilotActionName,
  canViewChildSafetyPilot, canManageChildSafetyPilot, canReviewChildSafetyPilot,
  canActivateChildSafetyPilot, canSuspendChildSafetyPilot, canViewChildSafetyPilotAudit,
  type IntegrationErrorCode,
} from "@guardora/core";
import { systemDb } from "./index";
import {
  type IntegrationActor, ChildSafetyIntegrationForbiddenError, ChildSafetyIntegrationNotFoundError,
  ChildSafetyIntegrationStateError, processIntegrationSignal,
} from "./child-safety-integration";

export type PilotActor = IntegrationActor;

// ── Server-internal defensive thresholds (NEVER exported to a client bundle) ──
const RATE_BAND_PER_MIN: Record<string, number> = { VERY_LOW: 5, LOW: 20, MEDIUM: 60, HIGH: 120 };
const MAX_LIST_IDS = 64; // bound on comma-joined scope lists
const sha256hex = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const BUSINESS_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const HARNESS_PATH = "/api/v1/child-safety/integrations/signals";

const splitList = (s: string | null | undefined): string[] => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const joinList = (xs: string[] | undefined, allowed?: readonly string[]): string => {
  const clean = [...new Set((xs ?? []).map((x) => String(x).trim()).filter(Boolean))].slice(0, MAX_LIST_IDS);
  return (allowed ? clean.filter((x) => allowed.includes(x)) : clean).join(",");
};

async function audit(tenantId: string, actorUserId: string | null, event: string, targetId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  const isSystem = !actorUserId || actorUserId === "system";
  await systemDb.auditLog.create({ data: { tenantId, event, actorKind: isSystem ? ActorKind.system : ActorKind.human, ...(isSystem ? {} : { actorUserId }), targetType: "child_safety_partner_pilot", targetId, metadata: metadata as never } }).catch(() => {});
}
async function appendEvent(tenantId: string, pilotId: string, eventType: string, actorUserId: string | null, extra: { fromStatus?: string; toStatus?: string; reasonCode?: string; summary?: string } = {}): Promise<void> {
  await systemDb.childSafetyPartnerPilotEvent.create({ data: { tenantId, pilotId, eventType, actorUserId: actorUserId && actorUserId !== "system" ? actorUserId : null, fromStatus: extra.fromStatus ?? null, toStatus: extra.toStatus ?? null, reasonCode: extra.reasonCode ?? null, summary: extra.summary ?? null } }).catch(() => {});
}

const assertView = (a: PilotActor) => { if (!canViewChildSafetyPilot(a.role)) throw new ChildSafetyIntegrationForbiddenError("pilot_view"); };
const assertManage = (a: PilotActor) => { if (!canManageChildSafetyPilot(a.role)) throw new ChildSafetyIntegrationForbiddenError("pilot_manage"); };
const assertReview = (a: PilotActor) => { if (!canReviewChildSafetyPilot(a.role)) throw new ChildSafetyIntegrationForbiddenError("pilot_review"); };
const assertActivate = (a: PilotActor) => { if (!canActivateChildSafetyPilot(a.role)) throw new ChildSafetyIntegrationForbiddenError("pilot_activate"); };
const assertSuspend = (a: PilotActor) => { if (!canSuspendChildSafetyPilot(a.role)) throw new ChildSafetyIntegrationForbiddenError("pilot_suspend"); };
const assertAudit = (a: PilotActor) => { if (!canViewChildSafetyPilotAudit(a.role)) throw new ChildSafetyIntegrationForbiddenError("pilot_audit_view"); };

async function loadPilot(tenantId: string, pilotId: string) {
  const p = await systemDb.childSafetyPartnerPilot.findFirst({ where: { id: pilotId, tenantId } });
  if (!p) throw new ChildSafetyIntegrationNotFoundError();
  return p;
}
/** Optimistic-concurrency guarded update: only writes when `version` still matches; bumps version. */
async function versionedUpdate(tenantId: string, pilotId: string, expectedVersion: number | undefined, data: Record<string, unknown>) {
  const where: Record<string, unknown> = { id: pilotId, tenantId };
  if (typeof expectedVersion === "number") where.version = expectedVersion;
  const res = await systemDb.childSafetyPartnerPilot.updateMany({ where, data: { ...data, version: { increment: 1 } } });
  if (res.count === 0) throw new ChildSafetyIntegrationStateError("version_conflict");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PILOT LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════
export interface CreatePilotInput {
  partnerId: string; applicationId: string;
  requestedCapabilities?: string[];
  expectedMonthlySignalVolumeBand?: string; expectedPeakRequestsPerMinuteBand?: string;
  intendedRegions?: string[]; intendedAgeBands?: string[]; intendedRiskCategories?: string[];
}
export async function createPartnerPilot(actor: PilotActor, input: CreatePilotInput): Promise<{ pilotId: string }> {
  assertManage(actor);
  const app = await systemDb.childSafetyIntegrationApplication.findFirst({ where: { id: input.applicationId, tenantId: actor.tenantId }, include: { partner: true } });
  if (!app) throw new ChildSafetyIntegrationNotFoundError();
  if (app.partnerId !== input.partnerId) throw new ChildSafetyIntegrationNotFoundError();
  // At most one non-terminal pilot per application.
  const existing = await systemDb.childSafetyPartnerPilot.findFirst({ where: { tenantId: actor.tenantId, applicationId: input.applicationId, status: { notIn: ["TERMINATED", "REJECTED"] } }, select: { id: true } });
  if (existing) throw new ChildSafetyIntegrationStateError("pilot_already_exists");
  if (input.expectedMonthlySignalVolumeBand && !PILOT_VOLUME_BANDS.includes(input.expectedMonthlySignalVolumeBand as never)) throw new ChildSafetyIntegrationStateError("bad_volume_band");
  if (input.expectedPeakRequestsPerMinuteBand && !PILOT_RATE_BANDS.includes(input.expectedPeakRequestsPerMinuteBand as never)) throw new ChildSafetyIntegrationStateError("bad_rate_band");

  const pilot = await systemDb.childSafetyPartnerPilot.create({ data: {
    tenantId: actor.tenantId, partnerId: input.partnerId, applicationId: input.applicationId, environment: app.environment,
    status: "DRAFT", requestedByUserId: actor.userId,
    requestedCapabilities: joinList(input.requestedCapabilities ?? ["signal.submit"], INTEGRATION_CAPABILITIES),
    expectedMonthlySignalVolumeBand: input.expectedMonthlySignalVolumeBand ?? null,
    expectedPeakRequestsPerMinuteBand: input.expectedPeakRequestsPerMinuteBand ?? null,
    intendedRegions: joinList(input.intendedRegions), intendedAgeBands: joinList(input.intendedAgeBands, PARTNER_AGE_BANDS),
    intendedRiskCategories: joinList(input.intendedRiskCategories, PARTNER_RISK_TYPES),
  } });
  // Seed every required check in NOT_STARTED.
  await systemDb.childSafetyPartnerPilotCheck.createMany({ data: PILOT_CHECK_TYPES.map((checkType) => ({ tenantId: actor.tenantId, pilotId: pilot.id, checkType, status: "NOT_STARTED" })) });
  await appendEvent(actor.tenantId, pilot.id, "PILOT_REQUESTED", actor.userId, { toStatus: "DRAFT" });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.created", pilot.id, { applicationId: input.applicationId });
  return { pilotId: pilot.id };
}

export interface UpdatePilotDraftInput {
  requestedCapabilities?: string[];
  expectedMonthlySignalVolumeBand?: string; expectedPeakRequestsPerMinuteBand?: string;
  intendedRegions?: string[]; intendedAgeBands?: string[]; intendedRiskCategories?: string[];
  reviewNotesSummary?: string;
}
export async function updatePartnerPilotDraft(actor: PilotActor, pilotId: string, patch: UpdatePilotDraftInput, expectedVersion?: number): Promise<{ ok: true }> {
  assertManage(actor);
  const p = await loadPilot(actor.tenantId, pilotId);
  if (!["DRAFT", "CHANGES_REQUIRED"].includes(p.status)) throw new ChildSafetyIntegrationStateError("not_editable");
  const data: Record<string, unknown> = {};
  if (patch.requestedCapabilities) data.requestedCapabilities = joinList(patch.requestedCapabilities, INTEGRATION_CAPABILITIES);
  if (patch.expectedMonthlySignalVolumeBand !== undefined) { if (patch.expectedMonthlySignalVolumeBand && !PILOT_VOLUME_BANDS.includes(patch.expectedMonthlySignalVolumeBand as never)) throw new ChildSafetyIntegrationStateError("bad_volume_band"); data.expectedMonthlySignalVolumeBand = patch.expectedMonthlySignalVolumeBand || null; }
  if (patch.expectedPeakRequestsPerMinuteBand !== undefined) { if (patch.expectedPeakRequestsPerMinuteBand && !PILOT_RATE_BANDS.includes(patch.expectedPeakRequestsPerMinuteBand as never)) throw new ChildSafetyIntegrationStateError("bad_rate_band"); data.expectedPeakRequestsPerMinuteBand = patch.expectedPeakRequestsPerMinuteBand || null; }
  if (patch.intendedRegions) data.intendedRegions = joinList(patch.intendedRegions);
  if (patch.intendedAgeBands) data.intendedAgeBands = joinList(patch.intendedAgeBands, PARTNER_AGE_BANDS);
  if (patch.intendedRiskCategories) data.intendedRiskCategories = joinList(patch.intendedRiskCategories, PARTNER_RISK_TYPES);
  if (patch.reviewNotesSummary !== undefined) { if (patch.reviewNotesSummary && !isSafeBoundedNote(patch.reviewNotesSummary)) throw new ChildSafetyIntegrationStateError("unsafe_note"); data.reviewNotesSummary = patch.reviewNotesSummary || null; }
  await versionedUpdate(actor.tenantId, pilotId, expectedVersion ?? p.version, data);
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.draft_updated", pilotId, {});
  return { ok: true };
}

export interface PilotScopeInput {
  approvedCapabilities?: string[]; approvedRiskCategories?: string[]; approvedRegions?: string[]; approvedAgeBands?: string[];
  allowedInstallationIds?: string[]; monthlyVolumeBand?: string; peakRateBand?: string;
  pilotStartDate?: string; pilotReviewDate?: string; pilotEndDate?: string;
}
/** Configure the bounded, server-approved pilot scope (governance). Manage permission. SCOPE_CHANGED event. */
export async function setPartnerPilotScope(actor: PilotActor, pilotId: string, input: PilotScopeInput, expectedVersion?: number): Promise<{ ok: true }> {
  assertManage(actor);
  const p = await loadPilot(actor.tenantId, pilotId);
  if (isTerminalPilotStatus(p.status)) throw new ChildSafetyIntegrationStateError("terminal");
  const data: Record<string, unknown> = {};
  if (input.approvedCapabilities) data.approvedCapabilities = joinList(input.approvedCapabilities, INTEGRATION_CAPABILITIES);
  if (input.approvedRiskCategories) data.approvedRiskCategories = joinList(input.approvedRiskCategories, PARTNER_RISK_TYPES);
  if (input.approvedRegions) data.approvedRegions = joinList(input.approvedRegions);
  if (input.approvedAgeBands) data.approvedAgeBands = joinList(input.approvedAgeBands, PARTNER_AGE_BANDS);
  if (input.allowedInstallationIds) {
    // Validate every id belongs to this application (tenant-safe).
    const ids = joinList(input.allowedInstallationIds);
    const idList = splitList(ids);
    if (idList.length) {
      const valid = await systemDb.childSafetyIntegrationInstallation.count({ where: { tenantId: actor.tenantId, applicationId: p.applicationId, id: { in: idList } } });
      if (valid !== idList.length) throw new ChildSafetyIntegrationStateError("bad_installation_scope");
    }
    data.allowedInstallationIds = ids;
  }
  if (input.monthlyVolumeBand !== undefined) { if (input.monthlyVolumeBand && !PILOT_VOLUME_BANDS.includes(input.monthlyVolumeBand as never)) throw new ChildSafetyIntegrationStateError("bad_volume_band"); data.monthlyVolumeBand = input.monthlyVolumeBand || null; }
  if (input.peakRateBand !== undefined) { if (input.peakRateBand && !PILOT_RATE_BANDS.includes(input.peakRateBand as never)) throw new ChildSafetyIntegrationStateError("bad_rate_band"); data.peakRateBand = input.peakRateBand || null; }
  for (const [k, v] of [["pilotStartDate", input.pilotStartDate], ["pilotReviewDate", input.pilotReviewDate], ["pilotEndDate", input.pilotEndDate]] as const) {
    if (v !== undefined) { const t = v ? Date.parse(v) : NaN; if (v && Number.isNaN(t)) throw new ChildSafetyIntegrationStateError("bad_date"); data[k] = v ? new Date(t) : null; }
  }
  await versionedUpdate(actor.tenantId, pilotId, expectedVersion ?? p.version, data);
  await appendEvent(actor.tenantId, pilotId, "SCOPE_CHANGED", actor.userId, {});
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.scope_changed", pilotId, {});
  return { ok: true };
}

/** Set a privacy/security/legal/operational assessment status (review permission). */
export async function setPartnerPilotAssessment(actor: PilotActor, pilotId: string, which: "privacy" | "security" | "legal" | "operational", status: string, expectedVersion?: number): Promise<{ ok: true }> {
  assertReview(actor);
  if (!PILOT_ASSESSMENT_STATUSES.includes(status as never)) throw new ChildSafetyIntegrationStateError("bad_assessment_status");
  const p = await loadPilot(actor.tenantId, pilotId);
  if (isTerminalPilotStatus(p.status)) throw new ChildSafetyIntegrationStateError("terminal");
  const field = which === "privacy" ? "privacyAssessmentStatus" : which === "security" ? "securityAssessmentStatus" : which === "legal" ? "legalAuthorizationStatus" : "operationalReadinessStatus";
  await versionedUpdate(actor.tenantId, pilotId, expectedVersion ?? p.version, { [field]: status });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.assessment_updated", pilotId, { which, status });
  return { ok: true };
}

// ── Readiness checks ──────────────────────────────────────────────────────────
export interface UpdateCheckInput { status: string; boundedComment?: string; evidenceReferenceType?: string; evidenceReferenceId?: string; waiverReasonCode?: string; }
export async function updatePartnerPilotCheck(actor: PilotActor, pilotId: string, checkType: string, input: UpdateCheckInput): Promise<{ ok: true }> {
  assertReview(actor);
  if (!(PILOT_CHECK_TYPES as readonly string[]).includes(checkType)) throw new ChildSafetyIntegrationStateError("bad_check_type");
  if (!["NOT_STARTED", "IN_REVIEW", "PASSED", "FAILED", "WAIVED"].includes(input.status)) throw new ChildSafetyIntegrationStateError("bad_check_status");
  const p = await loadPilot(actor.tenantId, pilotId);
  if (isTerminalPilotStatus(p.status)) throw new ChildSafetyIntegrationStateError("terminal");
  if (input.status === "WAIVED") {
    if (isNonWaivableCheck(checkType)) throw new ChildSafetyIntegrationStateError("check_not_waivable");
    if (!canManageChildSafetyPilot(actor.role) && !canActivateChildSafetyPilot(actor.role)) throw new ChildSafetyIntegrationForbiddenError("waive_requires_elevated");
    if (!input.waiverReasonCode) throw new ChildSafetyIntegrationStateError("waiver_reason_required");
  }
  if (input.boundedComment && !isSafeBoundedNote(input.boundedComment)) throw new ChildSafetyIntegrationStateError("unsafe_comment");
  await systemDb.childSafetyPartnerPilotCheck.update({
    where: { pilotId_checkType: { pilotId, checkType } },
    data: { status: input.status, checkedAt: new Date(), checkedByUserId: actor.userId, boundedComment: input.boundedComment ?? null, evidenceReferenceType: input.evidenceReferenceType?.slice(0, 40) ?? null, evidenceReferenceId: input.evidenceReferenceId?.slice(0, 64) ?? null, waiverReasonCode: input.status === "WAIVED" ? input.waiverReasonCode! : null },
  });
  const waived = input.status === "WAIVED";
  await appendEvent(actor.tenantId, pilotId, waived ? "CHECK_WAIVED" : "CHECK_UPDATED", actor.userId, { reasonCode: waived ? input.waiverReasonCode : undefined, summary: checkType });
  await audit(actor.tenantId, actor.userId, waived ? "child_safety.pilot.check_waived" : "child_safety.pilot.check_updated", pilotId, { checkType, status: input.status });
  return { ok: true };
}

// ── State machine transitions ───────────────────────────────────────────────
function assertActionPermission(actor: PilotActor, action: PilotActionName): void {
  switch (action) {
    case "submit": case "activate_sandbox": assertManage(actor); break;
    case "begin_review": case "request_changes": case "approve_sandbox": case "start_readiness": case "mark_ready": case "reject": assertReview(actor); break;
    case "activate": case "terminate": assertActivate(actor); break;
    case "pause": case "resume": case "suspend": assertSuspend(actor); break;
    default: throw new ChildSafetyIntegrationForbiddenError("unknown_action");
  }
}

/** Generic transition driver for the non-terminal lifecycle actions (submit/review/approve/sandbox/ready/
 *  pause/resume/reject). Activation, suspension, and termination have dedicated functions (extra rules). */
export async function transitionPartnerPilot(actor: PilotActor, pilotId: string, action: Exclude<PilotActionName, "activate" | "suspend" | "terminate">, opts: { reasonCode?: string; summary?: string; expectedVersion?: number } = {}): Promise<{ status: string }> {
  assertActionPermission(actor, action);
  const spec = PILOT_ACTIONS[action];
  const p = await loadPilot(actor.tenantId, pilotId);
  if (!spec.from.includes(p.status as never)) throw new ChildSafetyIntegrationStateError("bad_transition");
  if (!canTransitionPilot(p.status, spec.to)) throw new ChildSafetyIntegrationStateError("bad_transition");
  if (opts.summary && !isSafeBoundedNote(opts.summary)) throw new ChildSafetyIntegrationStateError("unsafe_note");
  const now = new Date();
  const data: Record<string, unknown> = { status: spec.to };
  if (action === "begin_review") { data.reviewedAt = now; data.reviewedByUserId = actor.userId; }
  if (action === "approve_sandbox") { data.approvedAt = now; data.approvedByUserId = actor.userId; }
  await versionedUpdate(actor.tenantId, pilotId, opts.expectedVersion ?? p.version, data);
  const eventType = action === "submit" ? "PILOT_REQUESTED" : action === "begin_review" ? "REVIEW_STARTED" : action === "request_changes" ? "CHANGES_REQUESTED" : action === "approve_sandbox" ? "PILOT_APPROVED" : action === "activate_sandbox" ? "SANDBOX_ENABLED" : action === "start_readiness" ? "READINESS_VERIFIED" : action === "mark_ready" ? "READINESS_VERIFIED" : action === "pause" ? "PILOT_PAUSED" : action === "resume" ? "PILOT_RESUMED" : action === "reject" ? "PILOT_REJECTED" : "CHECK_UPDATED";
  await appendEvent(actor.tenantId, pilotId, eventType, actor.userId, { fromStatus: p.status, toStatus: spec.to, reasonCode: opts.reasonCode, summary: opts.summary });
  await audit(actor.tenantId, actor.userId, `child_safety.pilot.${action}`, pilotId, { from: p.status, to: spec.to });
  return { status: spec.to };
}

/**
 * Activate a pilot (READY_FOR_PILOT → PILOT_ACTIVE). Activate permission (Owner/Admin) — a two-eyes control
 * over the reviewer's readiness sign-off. Enforces ALL activation prerequisites server-side, and NEVER
 * activates automatically: an authorized user must explicitly call this.
 */
export async function activatePartnerPilot(actor: PilotActor, pilotId: string, expectedVersion?: number): Promise<{ status: string }> {
  assertActivate(actor);
  const p = await loadPilot(actor.tenantId, pilotId);
  if (p.status !== "READY_FOR_PILOT") throw new ChildSafetyIntegrationStateError("bad_transition");
  // Readiness is RE-COMPUTED here (never trusts a stale stored value) so activation cannot ride an outdated
  // evaluation, and it never activates automatically — this requires the explicit authorized call.
  const readiness = await computeReadiness(actor.tenantId, p);
  if (readiness.state !== "READY") throw new ChildSafetyIntegrationStateError("not_ready");
  if (!splitList(p.approvedCapabilities).includes("signal.submit")) throw new ChildSafetyIntegrationStateError("capabilities_not_approved");

  // PRODUCTION activation prerequisites (fail-closed): the approved scope must be NON-EMPTY and every allowed
  // installation must exist for THIS application and be active, and the application itself must be active.
  // Without this, an empty approved-scope pilot would let the gateway's "empty = unrestricted" branch accept
  // any category / any installation in production.
  if (p.environment === "production") {
    const app = await systemDb.childSafetyIntegrationApplication.findFirst({ where: { id: p.applicationId, tenantId: actor.tenantId }, select: { status: true } });
    if (!app || app.status !== "active") throw new ChildSafetyIntegrationStateError("application_inactive");
    if (splitList(p.approvedRiskCategories).length === 0) throw new ChildSafetyIntegrationStateError("categories_not_approved");
    const allowed = splitList(p.allowedInstallationIds);
    if (allowed.length === 0) throw new ChildSafetyIntegrationStateError("installation_scope_empty");
    const activeAllowed = await systemDb.childSafetyIntegrationInstallation.count({ where: { tenantId: actor.tenantId, applicationId: p.applicationId, id: { in: allowed }, status: "active" } });
    if (activeAllowed !== allowed.length) throw new ChildSafetyIntegrationStateError("installation_inactive_or_out_of_scope");
  }

  const now = new Date();
  await versionedUpdate(actor.tenantId, pilotId, expectedVersion ?? p.version, { status: "PILOT_ACTIVE", activatedAt: now, activatedByUserId: actor.userId, operationalReadinessStatus: "APPROVED", readinessState: "READY" });
  await appendEvent(actor.tenantId, pilotId, "PILOT_ACTIVATED", actor.userId, { fromStatus: "READY_FOR_PILOT", toStatus: "PILOT_ACTIVE" });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.activated", pilotId, {});
  return { status: "PILOT_ACTIVE" };
}

/** Emergency, fail-closed SUSPEND (immediately stops production signal acceptance for the pilot). */
export async function suspendPartnerPilot(actor: PilotActor, pilotId: string, reasonCode: string, expectedVersion?: number): Promise<{ status: string }> {
  assertSuspend(actor);
  if (!PILOT_SUSPENSION_REASON_CODES.includes(reasonCode as never)) throw new ChildSafetyIntegrationStateError("bad_reason_code");
  const p = await loadPilot(actor.tenantId, pilotId);
  if (!canTransitionPilot(p.status, "SUSPENDED")) throw new ChildSafetyIntegrationStateError("bad_transition");
  await versionedUpdate(actor.tenantId, pilotId, expectedVersion ?? p.version, { status: "SUSPENDED", suspendedAt: new Date(), suspendedByUserId: actor.userId, suspensionReasonCode: reasonCode });
  await appendEvent(actor.tenantId, pilotId, "PILOT_SUSPENDED", actor.userId, { fromStatus: p.status, toStatus: "SUSPENDED", reasonCode });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.suspended", pilotId, { reasonCode });
  return { status: "SUSPENDED" };
}

/** Irreversible TERMINATE (activate permission — Owner/Admin). Terminal state; cannot be reopened. */
export async function terminatePartnerPilot(actor: PilotActor, pilotId: string, reasonCode: string, expectedVersion?: number): Promise<{ status: string }> {
  assertActivate(actor);
  if (!PILOT_TERMINATION_REASON_CODES.includes(reasonCode as never)) throw new ChildSafetyIntegrationStateError("bad_reason_code");
  const p = await loadPilot(actor.tenantId, pilotId);
  if (isTerminalPilotStatus(p.status)) throw new ChildSafetyIntegrationStateError("terminal");
  await versionedUpdate(actor.tenantId, pilotId, expectedVersion ?? p.version, { status: "TERMINATED", terminatedAt: new Date(), terminatedByUserId: actor.userId, terminationReasonCode: reasonCode });
  await appendEvent(actor.tenantId, pilotId, "PILOT_TERMINATED", actor.userId, { fromStatus: p.status, toStatus: "TERMINATED", reasonCode });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.terminated", pilotId, { reasonCode });
  return { status: "TERMINATED" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// READINESS ENGINE (assemble inputs → pure evaluator; advisory only)
// ═══════════════════════════════════════════════════════════════════════════════
type PilotRow = Awaited<ReturnType<typeof loadPilot>>;
async function computeReadiness(tenantId: string, p: PilotRow): Promise<ReadinessResult> {
  const [checks, passedRuns, activeInstallations, contacts, openCritical] = await Promise.all([
    systemDb.childSafetyPartnerPilotCheck.findMany({ where: { tenantId, pilotId: p.id }, select: { checkType: true, status: true } }),
    systemDb.childSafetyPartnerTestRun.findMany({ where: { tenantId, pilotId: p.id, result: "PASSED" }, select: { testType: true } }),
    systemDb.childSafetyIntegrationInstallation.findMany({ where: { tenantId, applicationId: p.applicationId, status: "active" }, select: { id: true } }),
    systemDb.childSafetyPartnerContact.findMany({ where: { tenantId, partnerId: p.partnerId, active: true }, select: { role: true } }),
    systemDb.childSafetyPartnerOperationalAlert.count({ where: { tenantId, pilotId: p.id, status: "open", severity: "CRITICAL" } }),
  ]);
  const instIds = activeInstallations.map((i) => i.id);
  const hasActiveKey = instIds.length > 0 && (await systemDb.childSafetyIntegrationKey.count({ where: { tenantId, installationId: { in: instIds }, status: "active" } })) > 0;
  const linkedSubjects = instIds.length > 0 ? await systemDb.childSafetyIntegrationSubject.count({ where: { tenantId, installationId: { in: instIds } } }) : 0;
  const contactRoles = new Set(contacts.map((c) => c.role));
  return evaluatePilotReadiness({
    status: p.status,
    checks: checks.map((c) => ({ checkType: c.checkType, status: c.status })),
    privacyAssessmentStatus: p.privacyAssessmentStatus, securityAssessmentStatus: p.securityAssessmentStatus, legalAuthorizationStatus: p.legalAuthorizationStatus,
    approvedCapabilities: splitList(p.approvedCapabilities),
    hasActiveInstallation: activeInstallations.length > 0, hasActiveKey,
    passedTestTypes: [...new Set(passedRuns.map((r) => r.testType))],
    rateLimitProfileSet: Boolean(p.monthlyVolumeBand && p.peakRateBand),
    subjectLinkingReady: linkedSubjects > 0,
    requiredContactRolesPresent: contactRoles.has("TECHNICAL") && contactRoles.has("INCIDENT_RESPONSE"),
    openCriticalAlertCount: openCritical,
    pilotWindowSet: Boolean(p.pilotStartDate && p.pilotEndDate),
    reviewDateSet: Boolean(p.pilotReviewDate),
  });
}

/** Evaluate + PERSIST readiness (advisory). view/review. Writes READINESS_EVALUATED event. */
export async function evaluatePartnerPilotReadiness(actor: PilotActor, pilotId: string): Promise<ReadinessResult> {
  assertView(actor);
  const p = await loadPilot(actor.tenantId, pilotId);
  const result = await computeReadiness(actor.tenantId, p);
  await systemDb.childSafetyPartnerPilot.updateMany({ where: { id: pilotId, tenantId: actor.tenantId }, data: { readinessState: result.state, readinessBlocking: result.blocking.join(","), readinessEvaluatedAt: new Date() } });
  await appendEvent(actor.tenantId, pilotId, "READINESS_EVALUATED", actor.userId, { summary: result.state });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.readiness_evaluated", pilotId, { state: result.state, blocking: result.blocking.length });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL CONTACTS (business contacts only; bounded)
// ═══════════════════════════════════════════════════════════════════════════════
export interface ContactInput { role: string; displayName: string; businessEmail: string; organizationUnit?: string; }
export async function upsertPartnerContact(actor: PilotActor, partnerId: string, input: ContactInput): Promise<{ contactId: string }> {
  assertManage(actor);
  const partner = await systemDb.childSafetyIntegrationPartner.findFirst({ where: { id: partnerId, tenantId: actor.tenantId }, select: { id: true } });
  if (!partner) throw new ChildSafetyIntegrationNotFoundError();
  if (!PILOT_CONTACT_ROLES.includes(input.role as never)) throw new ChildSafetyIntegrationStateError("bad_contact_role");
  if (!input.displayName?.trim() || input.displayName.length > 120) throw new ChildSafetyIntegrationStateError("bad_display_name");
  if (!BUSINESS_EMAIL_RE.test(input.businessEmail) || input.businessEmail.length > 200) throw new ChildSafetyIntegrationStateError("bad_business_email");
  if (input.organizationUnit && input.organizationUnit.length > 120) throw new ChildSafetyIntegrationStateError("bad_org_unit");
  const existing = await systemDb.childSafetyPartnerContact.findFirst({ where: { partnerId, role: input.role, businessEmail: input.businessEmail }, select: { id: true } });
  const c = existing
    ? await systemDb.childSafetyPartnerContact.update({ where: { id: existing.id }, data: { displayName: input.displayName.trim(), organizationUnit: input.organizationUnit?.trim() || null, active: true } })
    : await systemDb.childSafetyPartnerContact.create({ data: { tenantId: actor.tenantId, partnerId, role: input.role, displayName: input.displayName.trim(), businessEmail: input.businessEmail, organizationUnit: input.organizationUnit?.trim() || null } });
  await audit(actor.tenantId, actor.userId, existing ? "child_safety.pilot.contact_updated" : "child_safety.pilot.contact_added", c.id, { role: input.role });
  return { contactId: c.id };
}
export async function deactivatePartnerContact(actor: PilotActor, contactId: string): Promise<{ ok: true }> {
  assertManage(actor);
  const c = await systemDb.childSafetyPartnerContact.findFirst({ where: { id: contactId, tenantId: actor.tenantId } });
  if (!c) throw new ChildSafetyIntegrationNotFoundError();
  await systemDb.childSafetyPartnerContact.update({ where: { id: contactId }, data: { active: false } });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.contact_deactivated", contactId, {});
  return { ok: true };
}
export async function listPartnerContacts(actor: PilotActor, partnerId: string) {
  assertReview(actor); // sensitive operational metadata — review/manage roles only
  const rows = await systemDb.childSafetyPartnerContact.findMany({ where: { tenantId: actor.tenantId, partnerId }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, role: true, displayName: true, businessEmail: true, organizationUnit: true, active: true } });
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL ALERTS (content-free; deduplicated while open)
// ═══════════════════════════════════════════════════════════════════════════════
/** Raise (or dedup-increment) a content-free operational alert. Callable by the system (gateway) or an
 *  authorized user. Only bounded counters/timestamps + stable type/severity — never raw payload. */
export async function raisePartnerOperationalAlert(tenantId: string, pilotId: string, alertType: string, severity: string, opts: { installationRef?: string; boundedSummary?: string; actorUserId?: string | null } = {}): Promise<{ alertId: string }> {
  if (!PILOT_ALERT_TYPES.includes(alertType as never)) throw new ChildSafetyIntegrationStateError("bad_alert_type");
  if (!PILOT_ALERT_SEVERITIES.includes(severity as never)) throw new ChildSafetyIntegrationStateError("bad_severity");
  const now = new Date();
  const existing = await systemDb.childSafetyPartnerOperationalAlert.findFirst({ where: { tenantId, pilotId, alertType, status: "open" }, select: { id: true } });
  if (existing) {
    await systemDb.childSafetyPartnerOperationalAlert.update({ where: { id: existing.id }, data: { count: { increment: 1 }, lastSeenAt: now, severity } });
    return { alertId: existing.id };
  }
  const a = await systemDb.childSafetyPartnerOperationalAlert.create({ data: { tenantId, pilotId, alertType, severity, installationRef: opts.installationRef?.slice(0, 64) ?? null, boundedSummary: opts.boundedSummary && isSafeBoundedNote(opts.boundedSummary) ? opts.boundedSummary : null } });
  await appendEvent(tenantId, pilotId, "SECURITY_ALERT_RECORDED", opts.actorUserId ?? "system", { summary: alertType });
  await audit(tenantId, opts.actorUserId ?? "system", "child_safety.pilot.alert_created", a.id, { alertType, severity });
  return { alertId: a.id };
}
export async function resolvePartnerOperationalAlert(actor: PilotActor, alertId: string, reasonCode: string): Promise<{ ok: true }> {
  assertSuspend(actor); // resolving an operational alert is a governance action
  const a = await systemDb.childSafetyPartnerOperationalAlert.findFirst({ where: { id: alertId, tenantId: actor.tenantId } });
  if (!a) throw new ChildSafetyIntegrationNotFoundError();
  if (a.status === "resolved") return { ok: true };
  await systemDb.childSafetyPartnerOperationalAlert.update({ where: { id: alertId }, data: { status: "resolved", resolvedAt: new Date(), resolvedByUserId: actor.userId, resolutionReasonCode: reasonCode.slice(0, 40) } });
  await appendEvent(actor.tenantId, a.pilotId, "ALERT_RESOLVED", actor.userId, { reasonCode: reasonCode.slice(0, 40), summary: a.alertType });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.alert_resolved", alertId, { alertType: a.alertType });
  return { ok: true };
}
export async function listPartnerOperationalAlerts(actor: PilotActor, input: { pilotId?: string; status?: string; page?: number; pageSize?: number } = {}) {
  assertView(actor);
  const where: Record<string, unknown> = { tenantId: actor.tenantId };
  if (input.pilotId) where.pilotId = input.pilotId;
  if (input.status === "open" || input.status === "resolved") where.status = input.status;
  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize || 25)), 100);
  const page = Math.max(1, Math.floor(input.page || 1));
  const [total, rows] = await Promise.all([
    systemDb.childSafetyPartnerOperationalAlert.count({ where }),
    systemDb.childSafetyPartnerOperationalAlert.findMany({ where, orderBy: [{ lastSeenAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, pilotId: true, alertType: true, severity: true, status: true, count: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true } }),
  ]);
  return { total, page, pageSize, hasMore: page * pageSize < total, items: rows.map((r) => ({ ...r, firstSeenAt: r.firstSeenAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null })) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPATIBILITY TEST RUNS (content-free; real gateway behavior against an ephemeral sandbox harness)
// ═══════════════════════════════════════════════════════════════════════════════
async function ensureHarness(tenantId: string, membershipId: string, pilotId: string, withSubmit: boolean): Promise<string> {
  const short = pilotId.slice(-8).toLowerCase().replace(/[^a-z0-9]/g, "0");
  const partnerKey = `pilottest_${short}`;
  let partner = await systemDb.childSafetyIntegrationPartner.findFirst({ where: { tenantId, partnerKey }, select: { id: true } });
  if (!partner) partner = await systemDb.childSafetyIntegrationPartner.create({ data: { tenantId, partnerKey: partnerKey.slice(0, 63), displayName: "Pilot test harness", createdByMembershipId: membershipId, status: "active" }, select: { id: true } });
  const appKey = withSubmit ? `submit_${short}` : `deny_${short}`;
  let app = await systemDb.childSafetyIntegrationApplication.findFirst({ where: { tenantId, partnerId: partner.id, applicationKey: appKey }, select: { id: true } });
  if (!app) app = await systemDb.childSafetyIntegrationApplication.create({ data: { tenantId, partnerId: partner.id, applicationKey: appKey.slice(0, 63), displayName: "harness", environment: "sandbox", allowedCapabilities: withSubmit ? "signal.submit,signal.sandbox" : "signal.sandbox" }, select: { id: true } });
  const instKey = `hinst_${short}`;
  let inst = await systemDb.childSafetyIntegrationInstallation.findFirst({ where: { tenantId, applicationId: app.id, installationKey: instKey }, select: { id: true } });
  if (!inst) inst = await systemDb.childSafetyIntegrationInstallation.create({ data: { tenantId, partnerId: partner.id, applicationId: app.id, installationKey: instKey.slice(0, 63), status: "active" }, select: { id: true } });
  return inst.id;
}

function harnessEnv(installationId: string, partnerId: string, applicationId: string, iso: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: CHILD_SAFETY_SIGNAL_PROTOCOL, protocolVersion: CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION,
    eventId: randomUUID(), idempotencyKey: randomUUID(), partnerId, applicationId, installationId,
    occurredAt: iso, sentAt: iso, nonce: randomUUID(),
    signal: { externalSignalId: `probe_${randomUUID().slice(0, 8)}`, signalType: "GROOMING", confidenceBand: "high" },
    classification: { classifierType: "rule_engine", classifierVersion: "probe-1", classificationMethod: "automated", evaluatedAt: iso },
    subject: { pseudonymousSubjectId: "pilot_probe_subject", ageBand: "age_10_12" },
    context: { immediateDangerFlag: false },
    ...over,
  };
}
async function submitProbe(installationId: string, keyVersion: number, privateKey: import("node:crypto").KeyObject, env: Record<string, unknown>, now: Date, sentAtOverride?: string) {
  const body = JSON.stringify(env);
  const bodyHashHex = sha256hex(body);
  const ss = buildSigningString({ method: "POST", path: HARNESS_PATH, protocolVersion: env.protocolVersion as string, applicationId: env.applicationId as string, installationId, eventId: env.eventId as string, idempotencyKey: env.idempotencyKey as string, sentAt: (sentAtOverride ?? env.sentAt) as string, nonce: env.nonce as string, bodyHashHex });
  const signatureBase64 = edSign(null, Buffer.from(ss, "utf8"), privateKey).toString("base64");
  return processIntegrationSignal({ method: "POST", path: HARNESS_PATH, rawBody: body, signatureBase64, keyVersion, installationIdHeader: installationId }, now);
}

/**
 * Run one content-free compatibility test against an ephemeral sandbox harness. Registers a throwaway
 * public key, exercises real gateway behavior for the test type, records a bounded ChildSafetyPartnerTestRun
 * (test type / result / stable code only — NEVER a private key, raw body, full signature, or child data),
 * then revokes the ephemeral key. Manage or review permission.
 */
export async function runPartnerPilotCompatibilityTest(actor: PilotActor, pilotId: string, testType: string, now: Date = new Date()): Promise<{ testRunId: string; result: string; resultCode: string }> {
  if (!canManageChildSafetyPilot(actor.role) && !canReviewChildSafetyPilot(actor.role)) throw new ChildSafetyIntegrationForbiddenError("pilot_test_run");
  const p = await loadPilot(actor.tenantId, pilotId);
  if (isTerminalPilotStatus(p.status)) throw new ChildSafetyIntegrationStateError("terminal");
  const validTypes = ["SIGNATURE_COMPATIBILITY", "TIMESTAMP_WINDOW", "NONCE_REPLAY", "IDEMPOTENCY_DUPLICATE", "IDEMPOTENCY_CONFLICT", "PAYLOAD_VALIDATION", "CAPABILITY_ENFORCEMENT", "SUBJECT_LINKING", "RATE_LIMIT_BEHAVIOR"];
  if (!validTypes.includes(testType)) throw new ChildSafetyIntegrationStateError("bad_test_type");

  const needSubmit = testType !== "CAPABILITY_ENFORCEMENT";
  const installationId = await ensureHarness(actor.tenantId, actor.membershipId, pilotId, needSubmit);
  const inst = await systemDb.childSafetyIntegrationInstallation.findFirstOrThrow({ where: { id: installationId, tenantId: actor.tenantId }, select: { id: true, partnerId: true, applicationId: true } });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const latest = await systemDb.childSafetyIntegrationKey.findFirst({ where: { tenantId: actor.tenantId, installationId }, orderBy: { keyVersion: "desc" }, select: { keyVersion: true } });
  const keyVersion = (latest?.keyVersion ?? 0) + 1;
  const key = await systemDb.childSafetyIntegrationKey.create({ data: { tenantId: actor.tenantId, installationId, keyVersion, algorithm: "ed25519", publicKey: publicKeyDer.toString("base64"), fingerprint: sha256hex(publicKeyDer), status: "active" } });

  let result: "PASSED" | "FAILED" | "SKIPPED" = "FAILED";
  let resultCode = "INTERNAL_FAIL_CLOSED";
  let diagnosticCategory: string | null = null;
  try {
    const iso = now.toISOString();
    if (testType === "SIGNATURE_COMPATIBILITY") {
      const r = await submitProbe(installationId, keyVersion, privateKey, harnessEnv(installationId, inst.partnerId, inst.applicationId, iso), now);
      resultCode = r.code; result = r.code === "SIGNAL_ACCEPTED" ? "PASSED" : "FAILED";
    } else if (testType === "TIMESTAMP_WINDOW") {
      const stale = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
      const env = harnessEnv(installationId, inst.partnerId, inst.applicationId, stale);
      const r = await submitProbe(installationId, keyVersion, privateKey, env, now, stale);
      resultCode = r.code; result = r.code === "TIMESTAMP_OUT_OF_WINDOW" ? "PASSED" : "FAILED";
    } else if (testType === "NONCE_REPLAY") {
      const env1 = harnessEnv(installationId, inst.partnerId, inst.applicationId, iso);
      await submitProbe(installationId, keyVersion, privateKey, env1, now);
      const env2 = harnessEnv(installationId, inst.partnerId, inst.applicationId, iso, { nonce: env1.nonce }); // reuse nonce, new idempotency key
      const r = await submitProbe(installationId, keyVersion, privateKey, env2, now);
      resultCode = r.code; result = r.code === "NONCE_REPLAYED" ? "PASSED" : "FAILED";
    } else if (testType === "IDEMPOTENCY_DUPLICATE") {
      const env1 = harnessEnv(installationId, inst.partnerId, inst.applicationId, iso);
      await submitProbe(installationId, keyVersion, privateKey, env1, now);
      const r = await submitProbe(installationId, keyVersion, privateKey, env1, now); // identical
      resultCode = r.code; result = r.code === "SIGNAL_DUPLICATE" ? "PASSED" : "FAILED";
    } else if (testType === "IDEMPOTENCY_CONFLICT") {
      const env1 = harnessEnv(installationId, inst.partnerId, inst.applicationId, iso);
      await submitProbe(installationId, keyVersion, privateKey, env1, now);
      const env2 = harnessEnv(installationId, inst.partnerId, inst.applicationId, iso, { idempotencyKey: env1.idempotencyKey, signal: { externalSignalId: "probe_conflict", signalType: "SEXTORTION", confidenceBand: "high" } });
      const r = await submitProbe(installationId, keyVersion, privateKey, env2, now);
      resultCode = r.code; result = r.code === "IDEMPOTENCY_CONFLICT" ? "PASSED" : "FAILED";
    } else if (testType === "PAYLOAD_VALIDATION") {
      const env = harnessEnv(installationId, inst.partnerId, inst.applicationId, iso, { message: "should_be_rejected" }); // prohibited raw-content key
      const r = await submitProbe(installationId, keyVersion, privateKey, env, now);
      resultCode = r.code; result = r.code === "PAYLOAD_INVALID" ? "PASSED" : "FAILED";
    } else if (testType === "CAPABILITY_ENFORCEMENT") {
      const r = await submitProbe(installationId, keyVersion, privateKey, harnessEnv(installationId, inst.partnerId, inst.applicationId, iso), now);
      resultCode = r.code; result = r.code === "CAPABILITY_DENIED" ? "PASSED" : "FAILED";
    } else if (testType === "SUBJECT_LINKING") {
      // Unlinked subject → accepted receipt WITHOUT a canonical signal (subject-linking gating works).
      const r = await submitProbe(installationId, keyVersion, privateKey, harnessEnv(installationId, inst.partnerId, inst.applicationId, iso), now);
      resultCode = r.code; result = r.code === "SIGNAL_ACCEPTED" && !r.canonicalSignalId ? "PASSED" : "FAILED";
    } else { // RATE_LIMIT_BEHAVIOR — enforced per-band at the production gateway; not exercised in a local loop
      result = "SKIPPED"; resultCode = "SKIPPED"; diagnosticCategory = "band_enforced_at_production_gateway";
    }
  } catch { result = "FAILED"; resultCode = "INTERNAL_FAIL_CLOSED"; diagnosticCategory = "harness_error"; }
  finally {
    await systemDb.childSafetyIntegrationKey.update({ where: { id: key.id }, data: { status: "revoked", revokedAt: now } }).catch(() => {});
  }

  const run = await systemDb.childSafetyPartnerTestRun.create({ data: {
    tenantId: actor.tenantId, pilotId, installationId, testType, result, resultCode,
    keyVersion, protocolVersion: CHILD_SAFETY_SIGNAL_PROTOCOL_VERSION, syntheticEventReference: `probe_${randomUUID().slice(0, 12)}`, diagnosticCategory,
    startedAt: now, completedAt: new Date(),
  } });
  await appendEvent(actor.tenantId, pilotId, "TEST_RUN_RECORDED", actor.userId, { summary: `${testType}:${result}` });
  await audit(actor.tenantId, actor.userId, "child_safety.pilot.test_run", run.id, { testType, result });
  return { testRunId: run.id, result, resultCode };
}

// ═══════════════════════════════════════════════════════════════════════════════
// READS (role-aware projections)
// ═══════════════════════════════════════════════════════════════════════════════
function pilotSummary(p: PilotRow) {
  return {
    id: p.id, partnerId: p.partnerId, applicationId: p.applicationId, environment: p.environment, status: p.status, version: p.version,
    readinessState: p.readinessState, readinessBlocking: splitList(p.readinessBlocking),
    approvedCapabilities: splitList(p.approvedCapabilities), approvedRiskCategories: splitList(p.approvedRiskCategories),
    monthlyVolumeBand: p.monthlyVolumeBand, peakRateBand: p.peakRateBand,
    requestedAt: p.requestedAt.toISOString(), pilotStartDate: p.pilotStartDate?.toISOString() ?? null,
    pilotReviewDate: p.pilotReviewDate?.toISOString() ?? null, pilotEndDate: p.pilotEndDate?.toISOString() ?? null,
  };
}
export async function listPartnerPilots(actor: PilotActor, input: { status?: string; partnerId?: string; page?: number; pageSize?: number } = {}) {
  assertView(actor);
  const where: Record<string, unknown> = { tenantId: actor.tenantId };
  if (input.status && (PILOT_STATUSES as readonly string[]).includes(input.status)) where.status = input.status;
  if (input.partnerId) where.partnerId = input.partnerId;
  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize || 25)), 100);
  const page = Math.max(1, Math.floor(input.page || 1));
  const [total, rows, alertCounts] = await Promise.all([
    systemDb.childSafetyPartnerPilot.count({ where }),
    systemDb.childSafetyPartnerPilot.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    systemDb.childSafetyPartnerOperationalAlert.groupBy({ by: ["pilotId", "severity"], where: { tenantId: actor.tenantId, status: "open" }, _count: true }).catch(() => [] as Array<{ pilotId: string; severity: string; _count: number }>),
  ]);
  const worst = new Map<string, string>();
  for (const a of alertCounts as Array<{ pilotId: string; severity: string }>) {
    const cur = worst.get(a.pilotId);
    const rank = (s: string) => (s === "CRITICAL" ? 3 : s === "WARNING" ? 2 : 1);
    if (!cur || rank(a.severity) > rank(cur)) worst.set(a.pilotId, a.severity);
  }
  return { total, page, pageSize, hasMore: page * pageSize < total, items: rows.map((p) => ({ ...pilotSummary(p), alertSeverity: worst.get(p.id) ?? null })) };
}

/** Full pilot detail. Sensitive fields (contacts, review notes, bounded comments) are withheld from a
 *  view-only role (Analyst) — only review/manage roles see them. Events require audit_view. */
export async function getPartnerPilot(actor: PilotActor, pilotId: string) {
  assertView(actor);
  const p = await loadPilot(actor.tenantId, pilotId);
  const canReview = canReviewChildSafetyPilot(actor.role);
  const canAudit = canViewChildSafetyPilotAudit(actor.role);
  const [checks, testRuns, contacts, events, alerts] = await Promise.all([
    systemDb.childSafetyPartnerPilotCheck.findMany({ where: { tenantId: actor.tenantId, pilotId }, orderBy: { checkType: "asc" } }),
    systemDb.childSafetyPartnerTestRun.findMany({ where: { tenantId: actor.tenantId, pilotId }, orderBy: { startedAt: "desc" }, take: 50 }),
    canReview ? systemDb.childSafetyPartnerContact.findMany({ where: { tenantId: actor.tenantId, partnerId: p.partnerId }, orderBy: [{ role: "asc" }] }) : Promise.resolve([]),
    canAudit ? systemDb.childSafetyPartnerPilotEvent.findMany({ where: { tenantId: actor.tenantId, pilotId }, orderBy: { createdAt: "desc" }, take: 100 }) : Promise.resolve([]),
    systemDb.childSafetyPartnerOperationalAlert.findMany({ where: { tenantId: actor.tenantId, pilotId }, orderBy: { lastSeenAt: "desc" }, take: 50 }),
  ]);
  return {
    pilot: {
      ...pilotSummary(p),
      requestedCapabilities: splitList(p.requestedCapabilities),
      intendedRegions: splitList(p.intendedRegions), intendedAgeBands: splitList(p.intendedAgeBands), intendedRiskCategories: splitList(p.intendedRiskCategories),
      approvedRegions: splitList(p.approvedRegions), approvedAgeBands: splitList(p.approvedAgeBands),
      allowedInstallationIds: splitList(p.allowedInstallationIds),
      expectedMonthlySignalVolumeBand: p.expectedMonthlySignalVolumeBand, expectedPeakRequestsPerMinuteBand: p.expectedPeakRequestsPerMinuteBand,
      privacyAssessmentStatus: p.privacyAssessmentStatus, securityAssessmentStatus: p.securityAssessmentStatus, legalAuthorizationStatus: p.legalAuthorizationStatus, operationalReadinessStatus: p.operationalReadinessStatus,
      readinessEvaluatedAt: p.readinessEvaluatedAt?.toISOString() ?? null,
      reviewNotesSummary: canReview ? p.reviewNotesSummary : null,
      suspensionReasonCode: p.suspensionReasonCode, terminationReasonCode: p.terminationReasonCode,
    },
    checks: checks.map((c) => ({ checkType: c.checkType, status: c.status, checkedAt: c.checkedAt?.toISOString() ?? null, evidenceReferenceType: c.evidenceReferenceType, evidenceReferenceId: c.evidenceReferenceId, waiverReasonCode: c.waiverReasonCode, boundedComment: canReview ? c.boundedComment : null })),
    testRuns: testRuns.map((r) => ({ id: r.id, testType: r.testType, result: r.result, resultCode: r.resultCode, protocolVersion: r.protocolVersion, diagnosticCategory: r.diagnosticCategory, startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null })),
    contacts: canReview ? contacts.map((c) => ({ id: c.id, role: c.role, displayName: c.displayName, businessEmail: c.businessEmail, organizationUnit: c.organizationUnit, active: c.active })) : [],
    events: canAudit ? events.map((e) => ({ id: e.id, eventType: e.eventType, fromStatus: e.fromStatus, toStatus: e.toStatus, reasonCode: e.reasonCode, summary: e.summary, createdAt: e.createdAt.toISOString() })) : [],
    alerts: alerts.map((a) => ({ id: a.id, alertType: a.alertType, severity: a.severity, status: a.status, count: a.count, firstSeenAt: a.firstSeenAt.toISOString(), lastSeenAt: a.lastSeenAt.toISOString(), resolvedAt: a.resolvedAt?.toISOString() ?? null })),
  };
}

export async function listPartnerPilotEvents(actor: PilotActor, pilotId: string, input: { page?: number; pageSize?: number } = {}) {
  assertAudit(actor);
  await loadPilot(actor.tenantId, pilotId);
  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize || 50)), 200);
  const page = Math.max(1, Math.floor(input.page || 1));
  const [total, rows] = await Promise.all([
    systemDb.childSafetyPartnerPilotEvent.count({ where: { tenantId: actor.tenantId, pilotId } }),
    systemDb.childSafetyPartnerPilotEvent.findMany({ where: { tenantId: actor.tenantId, pilotId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { total, page, pageSize, hasMore: page * pageSize < total, items: rows.map((e) => ({ id: e.id, eventType: e.eventType, fromStatus: e.fromStatus, toStatus: e.toStatus, reasonCode: e.reasonCode, summary: e.summary, createdAt: e.createdAt.toISOString() })) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GATEWAY PILOT ENFORCEMENT (called by the signal gateway for PRODUCTION installations)
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Enforce pilot authorization for a PRODUCTION-environment installation. Fail-closed and NON-ENUMERATING:
 * every unauthorized pilot state maps to the existing INTEGRATION_SUSPENDED result (identical to a suspended
 * installation — it never reveals whether a pilot exists), and a band overage maps to RATE_LIMITED. Returns
 * null when the signal is authorized under an active pilot. NEVER weakens auth/replay/idempotency/validation.
 */
export async function enforceProductionPilotForSignal(tenantId: string, installationId: string, applicationId: string, signalType: string, ageBand: string | null, now: Date): Promise<IntegrationErrorCode | null> {
  const pilot = await systemDb.childSafetyPartnerPilot.findFirst({ where: { tenantId, applicationId, status: { notIn: ["TERMINATED", "REJECTED"] } }, orderBy: { createdAt: "desc" } });
  if (!pilot) return "INTEGRATION_SUSPENDED"; // no authorized pilot → fail closed
  if (pilot.status !== "PILOT_ACTIVE") return "INTEGRATION_SUSPENDED"; // paused/suspended/readiness/etc.
  if (pilot.pilotEndDate && pilot.pilotEndDate.getTime() < now.getTime()) return "INTEGRATION_SUSPENDED"; // expired
  if (pilot.pilotStartDate && pilot.pilotStartDate.getTime() > now.getTime()) return "INTEGRATION_SUSPENDED"; // not started

  const allowedInstalls = splitList(pilot.allowedInstallationIds);
  if (allowedInstalls.length > 0 && !allowedInstalls.includes(installationId)) { await scopeAlert(tenantId, pilot.id, installationId); return "INTEGRATION_SUSPENDED"; }
  if (!splitList(pilot.approvedCapabilities).includes("signal.submit")) return "INTEGRATION_SUSPENDED";
  const cats = splitList(pilot.approvedRiskCategories);
  if (cats.length > 0 && !cats.includes(signalType)) { await scopeAlert(tenantId, pilot.id, installationId); return "INTEGRATION_SUSPENDED"; }
  const ages = splitList(pilot.approvedAgeBands);
  if (ages.length > 0 && ageBand && !ages.includes(ageBand)) { await scopeAlert(tenantId, pilot.id, installationId); return "INTEGRATION_SUSPENDED"; }

  // Rate band — TIGHTEN only (never weakens the base gateway limit).
  const bandCap = pilot.peakRateBand ? RATE_BAND_PER_MIN[pilot.peakRateBand] : undefined;
  if (bandCap !== undefined) {
    const windowStart = new Date(now.getTime() - 60 * 1000);
    const recent = await systemDb.childSafetySignalReceipt.count({ where: { installationId, receivedAt: { gte: windowStart } } });
    if (recent >= bandCap) return "RATE_LIMITED";
  }
  return null;
}
async function scopeAlert(tenantId: string, pilotId: string, installationId: string): Promise<void> {
  await raisePartnerOperationalAlert(tenantId, pilotId, "PILOT_SCOPE_VIOLATION", "WARNING", { installationRef: installationId, actorUserId: "system" }).catch(() => {});
}

export { RATE_BAND_PER_MIN as PILOT_RATE_BAND_PER_MIN_INTERNAL };
