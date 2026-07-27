/**
 * Child Safety Analytics & Trends V1 — the web server boundary. Resolves the authenticated session into a
 * tenant-scoped, role-typed actor, calls the @guardora/db analytics service, and maps results/errors to
 * SAFE, stable JSON (never leaks Prisma / stack / cross-tenant existence / raw content). View is Owner /
 * Administrator / Safety Reviewer; CSV export is Owner / Administrator only. There is NO public, guardian,
 * SDK, or gateway path here.
 */
import {
  type AnalyticsActor, ChildSafetyAnalyticsForbiddenError,
  getChildSafetyAnalyticsReport, exportChildSafetyAnalyticsCsv,
} from "@guardora/db";
import { canViewChildSafetyAnalytics, parseGranularity } from "@guardora/core";
import { getSession } from "@/server/auth";

export interface AnalyticsHttpResult { status: number; body: Record<string, unknown>; }
const ok = (body: Record<string, unknown>): AnalyticsHttpResult => ({ status: 200, body: { ok: true, ...body } });
const err = (status: number, code: string): AnalyticsHttpResult => ({ status, body: { ok: false, error: code } });

/** Resolve a verified session into an analytics actor, or a fail-closed denial. `view` is the floor. */
async function resolveActor(): Promise<{ actor: AnalyticsActor } | { denied: AnalyticsHttpResult }> {
  const session = await getSession();
  if (!session || !session.emailVerified) return { denied: err(401, "unauthenticated") };
  if (!canViewChildSafetyAnalytics(session.role)) return { denied: err(403, "forbidden") };
  return { actor: { tenantId: session.tenantId, userId: session.userId, role: session.role } };
}

/** Map any thrown error to a safe, stable HTTP result (never a raw message/stack). */
function mapError(e: unknown): AnalyticsHttpResult {
  if (e instanceof ChildSafetyAnalyticsForbiddenError) return err(403, "forbidden");
  return err(500, "internal");
}

function parseDate(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
function parseInput(params: URLSearchParams) {
  return {
    from: parseDate(params.get("from")),
    to: parseDate(params.get("to")),
    granularity: parseGranularity(params.get("granularity")),
  };
}

/** GET the aggregated analytics report. Read; session + view permission only. */
export async function analyticsReport(params: URLSearchParams): Promise<AnalyticsHttpResult> {
  const r = await resolveActor();
  if ("denied" in r) return r.denied;
  try { return ok({ report: await getChildSafetyAnalyticsReport(r.actor, parseInput(params)) }); }
  catch (e) { return mapError(e); }
}

export interface AnalyticsCsvResult {
  status: number;
  csv?: string;
  filename?: string;
  error?: string;
}
/**
 * GET the aggregated-metrics CSV. Gated by the EXPORT permission (Owner / Administrator only) which the
 * service re-checks; a Reviewer (view-only) receives 403. Aggregated metrics only — never ids / PII.
 */
export async function analyticsCsv(params: URLSearchParams): Promise<AnalyticsCsvResult> {
  const r = await resolveActor();
  if ("denied" in r) return { status: r.denied.status, error: String(r.denied.body.error) };
  try {
    const report = await getChildSafetyAnalyticsReport(r.actor, parseInput(params));
    const { filename, csv } = exportChildSafetyAnalyticsCsv(r.actor, report); // throws Forbidden if not export-authorized
    return { status: 200, csv, filename };
  } catch (e) {
    const mapped = mapError(e);
    return { status: mapped.status, error: String(mapped.body.error) };
  }
}
