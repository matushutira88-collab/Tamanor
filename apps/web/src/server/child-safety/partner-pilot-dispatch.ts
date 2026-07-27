/**
 * Child Safety Partner Pilot Operations V1 — PURE action dispatch (no Next request/session/server-only
 * dependency). Strict bounded parsing (the repo convention — no raw DB/stack leakage, NO private-key input,
 * NO raw-message field, no client-selected tenant/status), prohibited-key rejection, safe error mapping, and
 * service-layer delegation (every state transition goes through the service). `pilotAction` wraps this after
 * same-origin + session checks; this module is import-safe in a plain test runner.
 */
import {
  type PilotActor,
  ChildSafetyIntegrationForbiddenError, ChildSafetyIntegrationNotFoundError, ChildSafetyIntegrationStateError,
  createPartnerPilot, updatePartnerPilotDraft, setPartnerPilotScope, setPartnerPilotAssessment, updatePartnerPilotCheck,
  transitionPartnerPilot, activatePartnerPilot, suspendPartnerPilot, terminatePartnerPilot,
  evaluatePartnerPilotReadiness, runPartnerPilotCompatibilityTest,
  upsertPartnerContact, deactivatePartnerContact, resolvePartnerOperationalAlert,
} from "@guardora/db";

export interface PilotHttpResult { status: number; body: Record<string, unknown>; }
export const ok = (body: Record<string, unknown>): PilotHttpResult => ({ status: 200, body: { ok: true, ...body } });
export const err = (status: number, code: string): PilotHttpResult => ({ status, body: { ok: false, error: code } });

// Sensitive keys that must NEVER appear in a pilot mutation body (defense in depth on top of whitelisting).
export const FORBIDDEN_BODY_KEYS = ["privatekey", "private_key", "message", "messagetext", "transcript", "content", "body", "rawbody", "credential", "password", "token", "cookie", "childname", "guardian"];
export function bodyHasForbiddenKey(b: Record<string, unknown>, depth = 0): boolean {
  if (depth > 4 || b === null || typeof b !== "object") return false;
  for (const [k, v] of Object.entries(b)) {
    if (FORBIDDEN_BODY_KEYS.includes(k.toLowerCase())) return true;
    if (v && typeof v === "object" && bodyHasForbiddenKey(v as Record<string, unknown>, depth + 1)) return true;
  }
  return false;
}

export function mapError(e: unknown): PilotHttpResult {
  if (e instanceof ChildSafetyIntegrationForbiddenError) return err(403, "forbidden");
  if (e instanceof ChildSafetyIntegrationNotFoundError) return err(404, "not_found");
  if (e instanceof ChildSafetyIntegrationStateError) return err(409, e.code);
  return err(500, "internal");
}

// ── Strict bounded parsers ────────────────────────────────────────────────────
const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const strArr = (v: unknown, max = 64): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const TRANSITIONS = ["submit", "begin_review", "request_changes", "approve_sandbox", "activate_sandbox", "start_readiness", "mark_ready", "pause", "resume", "reject"] as const;

export async function dispatchPilotAction(actor: PilotActor, b: Record<string, unknown>): Promise<PilotHttpResult> {
  if (bodyHasForbiddenKey(b)) return err(400, "prohibited_field");
  const action = String(b.action ?? "");
  const ev = num(b.expectedVersion);
  try {
    switch (action) {
      case "create_pilot": {
        const partnerId = str(b.partnerId), applicationId = str(b.applicationId);
        if (!partnerId || !applicationId) return err(400, "bad_input");
        return ok(await createPartnerPilot(actor, { partnerId, applicationId, requestedCapabilities: strArr(b.requestedCapabilities), expectedMonthlySignalVolumeBand: str(b.expectedMonthlySignalVolumeBand, 16), expectedPeakRequestsPerMinuteBand: str(b.expectedPeakRequestsPerMinuteBand, 16), intendedRegions: strArr(b.intendedRegions), intendedAgeBands: strArr(b.intendedAgeBands), intendedRiskCategories: strArr(b.intendedRiskCategories) }));
      }
      case "update_draft": {
        const pilotId = str(b.pilotId); if (!pilotId) return err(400, "bad_input");
        return ok(await updatePartnerPilotDraft(actor, pilotId, { requestedCapabilities: strArr(b.requestedCapabilities), expectedMonthlySignalVolumeBand: str(b.expectedMonthlySignalVolumeBand, 16), expectedPeakRequestsPerMinuteBand: str(b.expectedPeakRequestsPerMinuteBand, 16), intendedRegions: strArr(b.intendedRegions), intendedAgeBands: strArr(b.intendedAgeBands), intendedRiskCategories: strArr(b.intendedRiskCategories), reviewNotesSummary: str(b.reviewNotesSummary, 500) }, ev));
      }
      case "set_scope": {
        const pilotId = str(b.pilotId); if (!pilotId) return err(400, "bad_input");
        return ok(await setPartnerPilotScope(actor, pilotId, { approvedCapabilities: strArr(b.approvedCapabilities), approvedRiskCategories: strArr(b.approvedRiskCategories), approvedRegions: strArr(b.approvedRegions), approvedAgeBands: strArr(b.approvedAgeBands), allowedInstallationIds: strArr(b.allowedInstallationIds), monthlyVolumeBand: str(b.monthlyVolumeBand, 16), peakRateBand: str(b.peakRateBand, 16), pilotStartDate: str(b.pilotStartDate, 40), pilotReviewDate: str(b.pilotReviewDate, 40), pilotEndDate: str(b.pilotEndDate, 40) }, ev));
      }
      case "set_assessment": {
        const pilotId = str(b.pilotId), which = str(b.which, 16), status = str(b.status, 16);
        if (!pilotId || !which || !status || !["privacy", "security", "legal", "operational"].includes(which)) return err(400, "bad_input");
        return ok(await setPartnerPilotAssessment(actor, pilotId, which as "privacy" | "security" | "legal" | "operational", status, ev));
      }
      case "update_check": {
        const pilotId = str(b.pilotId), checkType = str(b.checkType, 48), status = str(b.status, 16);
        if (!pilotId || !checkType || !status) return err(400, "bad_input");
        return ok(await updatePartnerPilotCheck(actor, pilotId, checkType, { status, boundedComment: str(b.boundedComment, 500), evidenceReferenceType: str(b.evidenceReferenceType, 40), evidenceReferenceId: str(b.evidenceReferenceId, 64), waiverReasonCode: str(b.waiverReasonCode, 40) }));
      }
      case "transition": {
        const pilotId = str(b.pilotId), t = str(b.transition, 24);
        if (!pilotId || !t || !(TRANSITIONS as readonly string[]).includes(t)) return err(400, "bad_input");
        return ok(await transitionPartnerPilot(actor, pilotId, t as (typeof TRANSITIONS)[number], { reasonCode: str(b.reasonCode, 40), summary: str(b.summary, 500), expectedVersion: ev }));
      }
      case "activate": {
        const pilotId = str(b.pilotId); if (!pilotId) return err(400, "bad_input");
        return ok(await activatePartnerPilot(actor, pilotId, ev));
      }
      case "suspend": {
        const pilotId = str(b.pilotId), reasonCode = str(b.reasonCode, 40);
        if (!pilotId || !reasonCode) return err(400, "bad_input");
        return ok(await suspendPartnerPilot(actor, pilotId, reasonCode, ev));
      }
      case "terminate": {
        const pilotId = str(b.pilotId), reasonCode = str(b.reasonCode, 40);
        if (!pilotId || !reasonCode) return err(400, "bad_input");
        return ok(await terminatePartnerPilot(actor, pilotId, reasonCode, ev));
      }
      case "evaluate_readiness": {
        const pilotId = str(b.pilotId); if (!pilotId) return err(400, "bad_input");
        return ok({ readiness: await evaluatePartnerPilotReadiness(actor, pilotId) });
      }
      case "run_test": {
        const pilotId = str(b.pilotId), testType = str(b.testType, 32);
        if (!pilotId || !testType) return err(400, "bad_input");
        return ok(await runPartnerPilotCompatibilityTest(actor, pilotId, testType));
      }
      case "upsert_contact": {
        const partnerId = str(b.partnerId), role = str(b.role, 24), displayName = str(b.displayName, 120), businessEmail = str(b.businessEmail, 200);
        if (!partnerId || !role || !displayName || !businessEmail) return err(400, "bad_input");
        return ok(await upsertPartnerContact(actor, partnerId, { role, displayName, businessEmail, organizationUnit: str(b.organizationUnit, 120) }));
      }
      case "deactivate_contact": {
        const contactId = str(b.contactId); if (!contactId) return err(400, "bad_input");
        return ok(await deactivatePartnerContact(actor, contactId));
      }
      case "resolve_alert": {
        const alertId = str(b.alertId), reasonCode = str(b.reasonCode, 40);
        if (!alertId || !reasonCode) return err(400, "bad_input");
        return ok(await resolvePartnerOperationalAlert(actor, alertId, reasonCode));
      }
      default: return err(400, "unknown_action");
    }
  } catch (e) { return mapError(e); }
}
