/**
 * Child Safety Reviewer Workspace V1 — the web server module. Thin boundary between the authenticated
 * request and the @guardora/db reviewer service: resolve the session → build a tenant-scoped, role-typed
 * ReviewerActor → call the service → map results/errors to SAFE, stable JSON (never leaks Prisma / stack /
 * cross-tenant existence / raw content). All access is Owner / Administrator / Safety Reviewer only; there
 * is NO public, guardian, SDK, or gateway path to these functions.
 */
import {
  type ReviewerActor, type IncidentListInput,
  ChildSafetyReviewForbiddenError, ChildSafetyReviewNotFoundError,
  listChildSafetyIncidents, getChildSafetyIncidentDetail, getChildSafetyReviewerDashboard,
  assignChildSafetyIncident, unassignChildSafetyIncident, addChildSafetyReviewerNote, setChildSafetyReviewStatus,
} from "@guardora/db";
import {
  parseIncidentSort, ChildSafetyIncidentListFilter, isChildSafetyReviewStatus, canViewChildSafetyReview,
  type ChildSafetyReviewStatus,
} from "@guardora/core";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";

export interface ReviewerHttpResult { status: number; body: Record<string, unknown>; }
const ok = (body: Record<string, unknown>): ReviewerHttpResult => ({ status: 200, body: { ok: true, ...body } });
const err = (status: number, code: string): ReviewerHttpResult => ({ status, body: { ok: false, error: code } });

const INPUT_ERROR_CODES = new Set(["assignee_required", "note_empty", "note_too_long"]);

/** Resolve a verified session into a reviewer actor, or a fail-closed denial. `view` is the floor. */
async function resolveActor(): Promise<{ actor: ReviewerActor } | { denied: ReviewerHttpResult }> {
  const session = await getSession();
  if (!session || !session.emailVerified) return { denied: err(401, "unauthenticated") };
  if (!canViewChildSafetyReview(session.role)) return { denied: err(403, "forbidden") };
  return { actor: { tenantId: session.tenantId, userId: session.userId, role: session.role } };
}

/** Map any thrown error to a safe, stable HTTP result. */
function mapError(e: unknown): ReviewerHttpResult {
  if (e instanceof ChildSafetyReviewForbiddenError) return err(403, "forbidden");
  if (e instanceof ChildSafetyReviewNotFoundError) return err(404, "not_found");
  const msg = e instanceof Error ? e.message : "";
  if (msg.startsWith("invalid_transition:")) return err(409, "invalid_transition");
  if (INPUT_ERROR_CODES.has(msg)) return err(400, msg);
  return err(500, "internal");
}

function parseDate(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** GET incidents list — query params → typed input. Read; session + view permission only. */
export async function reviewerListIncidents(params: URLSearchParams): Promise<ReviewerHttpResult> {
  const r = await resolveActor();
  if ("denied" in r) return r.denied;
  const listFilterRaw = params.get("filter");
  const listFilter = (Object.values(ChildSafetyIncidentListFilter) as string[]).includes(listFilterRaw ?? "") ? (listFilterRaw as ChildSafetyIncidentListFilter) : undefined;
  const input: IncidentListInput = {
    profileId: params.get("profileId") ?? undefined,
    severity: params.get("severity") ?? undefined,
    urgency: params.get("urgency") ?? undefined,
    escalationState: params.get("escalationState") ?? undefined,
    status: params.get("status") ?? undefined,
    listFilter,
    search: params.get("search")?.trim() || undefined,
    createdFrom: parseDate(params.get("createdFrom")), createdTo: parseDate(params.get("createdTo")),
    updatedFrom: parseDate(params.get("updatedFrom")), updatedTo: parseDate(params.get("updatedTo")),
    sort: parseIncidentSort(params.get("sort")),
    page: Number(params.get("page")) || 1,
    pageSize: Number(params.get("pageSize")) || undefined,
  };
  try { return ok(await listChildSafetyIncidents(r.actor, input) as unknown as Record<string, unknown>); }
  catch (e) { return mapError(e); }
}

/** GET incident detail. Read; session + view permission only. */
export async function reviewerIncidentDetail(incidentId: string): Promise<ReviewerHttpResult> {
  const r = await resolveActor();
  if ("denied" in r) return r.denied;
  try { return ok(await getChildSafetyIncidentDetail(r.actor, incidentId) as unknown as Record<string, unknown>); }
  catch (e) { return mapError(e); }
}

/** GET dashboard summary. Read; session + view permission only. */
export async function reviewerDashboard(): Promise<ReviewerHttpResult> {
  const r = await resolveActor();
  if ("denied" in r) return r.denied;
  try { return ok(await getChildSafetyReviewerDashboard(r.actor) as unknown as Record<string, unknown>); }
  catch (e) { return mapError(e); }
}

/** POST review action. MUTATING → same-origin (CSRF) + manage permission (enforced in the service). */
export async function reviewerAction(incidentId: string, body: unknown): Promise<ReviewerHttpResult> {
  if (!(await isSameOrigin())) return err(403, "forbidden");
  const r = await resolveActor();
  if ("denied" in r) return r.denied;
  const b = (body ?? {}) as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "";
  try {
    switch (action) {
      case "assign": return ok(await assignChildSafetyIncident(r.actor, incidentId, String(b.assigneeUserId ?? "")));
      case "unassign": return ok(await unassignChildSafetyIncident(r.actor, incidentId));
      case "note": return ok(await addChildSafetyReviewerNote(r.actor, incidentId, String(b.body ?? "")));
      case "status": {
        const to = String(b.status ?? "");
        if (!isChildSafetyReviewStatus(to)) return err(400, "invalid_status");
        return ok(await setChildSafetyReviewStatus(r.actor, incidentId, to as ChildSafetyReviewStatus));
      }
      default: return err(400, "unknown_action");
    }
  } catch (e) { return mapError(e); }
}
