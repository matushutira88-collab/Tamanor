/**
 * Child Safety Partner Pilot Operations V1 — web server boundary (session-authenticated, tenant-scoped,
 * permission-gated, same-origin for mutations). Reads resolve a session actor; the mutation dispatch (strict
 * bounded parsing, prohibited-key rejection, safe error mapping, service-layer state transitions) lives in
 * the import-safe {@link dispatchPilotAction}. Content-free operational metadata only — no raw-message field,
 * no private-key input, no client-selected tenant or status.
 */
import {
  type PilotActor, systemDb,
  listPartnerPilots, getPartnerPilot, listPartnerPilotEvents, listPartnerOperationalAlerts, listPartnerContacts,
} from "@guardora/db";
import { canViewChildSafetyPilot } from "@guardora/core";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";
import { type PilotHttpResult, ok, err, mapError, dispatchPilotAction } from "./partner-pilot-dispatch";

export type { PilotHttpResult } from "./partner-pilot-dispatch";
export { dispatchPilotAction } from "./partner-pilot-dispatch";

const MAX_BODY = 64 * 1024;

async function resolveActor(): Promise<{ actor: PilotActor } | { denied: PilotHttpResult }> {
  const session = await getSession();
  if (!session || !session.emailVerified) return { denied: err(401, "unauthenticated") };
  if (!canViewChildSafetyPilot(session.role)) return { denied: err(403, "forbidden") };
  const m = await systemDb.membership.findFirst({ where: { userId: session.userId, tenantId: session.tenantId }, select: { id: true } });
  if (!m) return { denied: err(403, "forbidden") };
  return { actor: { tenantId: session.tenantId, userId: session.userId, membershipId: m.id, role: session.role } };
}
const tooLarge = (b: unknown): boolean => { try { return JSON.stringify(b ?? {}).length > MAX_BODY; } catch { return true; } };

// ── Reads ─────────────────────────────────────────────────────────────────────
export async function pilotList(params: URLSearchParams): Promise<PilotHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok(await listPartnerPilots(r.actor, { status: params.get("status") ?? undefined, partnerId: params.get("partnerId") ?? undefined, page: Number(params.get("page")) || 1, pageSize: Number(params.get("pageSize")) || undefined }) as unknown as Record<string, unknown>); } catch (e) { return mapError(e); }
}
export async function pilotGet(pilotId: string): Promise<PilotHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok(await getPartnerPilot(r.actor, pilotId) as unknown as Record<string, unknown>); } catch (e) { return mapError(e); }
}
export async function pilotEvents(pilotId: string, params: URLSearchParams): Promise<PilotHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok(await listPartnerPilotEvents(r.actor, pilotId, { page: Number(params.get("page")) || 1, pageSize: Number(params.get("pageSize")) || undefined }) as unknown as Record<string, unknown>); } catch (e) { return mapError(e); }
}
export async function pilotAlerts(params: URLSearchParams): Promise<PilotHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok(await listPartnerOperationalAlerts(r.actor, { pilotId: params.get("pilotId") ?? undefined, status: params.get("status") ?? undefined, page: Number(params.get("page")) || 1, pageSize: Number(params.get("pageSize")) || undefined }) as unknown as Record<string, unknown>); } catch (e) { return mapError(e); }
}
export async function pilotContacts(partnerId: string): Promise<PilotHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok({ contacts: await listPartnerContacts(r.actor, partnerId) }); } catch (e) { return mapError(e); }
}

// ── Mutations (same-origin) — wraps the import-safe dispatch after auth. ──
export async function pilotAction(body: unknown): Promise<PilotHttpResult> {
  if (!(await isSameOrigin())) return err(403, "forbidden");
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  if (tooLarge(body)) return err(413, "too_large");
  return dispatchPilotAction(r.actor, (body ?? {}) as Record<string, unknown>);
}
