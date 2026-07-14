/**
 * V1.45C1 — the ONE authoritative server-side tenant-activity guard.
 *
 * `assertTenantActive` is the single primitive every activity path calls to decide whether a tenant
 * may still create sessions, data, syncs, memberships, or provider connections. It is FAIL-CLOSED:
 * a missing tenant, a `deleting` tenant, an unknown state, or a DB lookup error all DENY. It NEVER
 * trusts client input — the caller passes a tenantId that came from a validated session or a trusted
 * system path, and the state is read FRESH from the DB on every check (never cached in a session), so
 * a deletion takes effect immediately for every in-flight and future request.
 *
 * The deletion orchestrator and narrow system cleanup paths deliberately do NOT call this guard —
 * they are the only code permitted to touch a `deleting` tenant.
 *
 * Reads default to the owner client (`prisma`/`systemDb`) — a single-tenant lookup by id, the same
 * client session hydration already uses to resolve the active tenant.
 */
import { PrismaClient, TenantDeletionState } from "@prisma/client";
import { prisma } from "./index";

export type TenantActivityRejectReason = "tenant_missing" | "tenant_deleting" | "lookup_failed";

export interface TenantActivityState {
  /** true ONLY when the tenant exists and is `active`. */
  ok: boolean;
  reason?: TenantActivityRejectReason;
  deletionState?: TenantDeletionState;
}

/** Thrown by {@link assertTenantActive}. Carries a normalized code only — never tenant name/PII. */
export class TenantInactiveError extends Error {
  readonly code: TenantActivityRejectReason;
  constructor(reason: TenantActivityRejectReason) {
    super(`tenant_not_active:${reason}`);
    this.name = "TenantInactiveError";
    this.code = reason;
  }
}

export function isTenantInactiveError(e: unknown): e is TenantInactiveError {
  return e instanceof TenantInactiveError || ["tenant_missing", "tenant_deleting", "lookup_failed"].includes((e as { code?: string })?.code ?? "");
}

/**
 * Resolve a tenant's activity state. Fail-closed: any problem (missing id, missing row, DB error,
 * unknown enum) resolves to NOT-ok. Never throws; returns a structured verdict.
 */
export async function getTenantActivityState(
  tenantId: string | null | undefined,
  client: PrismaClient = prisma,
): Promise<TenantActivityState> {
  if (!tenantId || typeof tenantId !== "string") return { ok: false, reason: "tenant_missing" };
  try {
    const t = await client.tenant.findUnique({ where: { id: tenantId }, select: { deletionState: true } });
    if (!t) return { ok: false, reason: "tenant_missing" };
    if (t.deletionState === TenantDeletionState.active) return { ok: true, deletionState: t.deletionState };
    // `deleting` (or any non-active state) → deny.
    return { ok: false, reason: "tenant_deleting", deletionState: t.deletionState };
  } catch (e) {
    // Fail CLOSED on a DB error, but keep it diagnostically visible (safe payload only — no PII).
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ evt: "tenant.activity_state_error", error: (e as Error)?.name ?? "unknown", code: (e as { code?: string })?.code ?? null }));
    return { ok: false, reason: "lookup_failed" };
  }
}

/** Fail-closed assertion for activity paths. Throws {@link TenantInactiveError} unless the tenant is active. */
export async function assertTenantActive(
  tenantId: string | null | undefined,
  client: PrismaClient = prisma,
): Promise<void> {
  const state = await getTenantActivityState(tenantId, client);
  if (!state.ok) throw new TenantInactiveError(state.reason ?? "lookup_failed");
}

/** Non-throwing convenience: true only when the tenant is active. */
export async function isTenantActive(tenantId: string | null | undefined, client: PrismaClient = prisma): Promise<boolean> {
  return (await getTenantActivityState(tenantId, client)).ok;
}
