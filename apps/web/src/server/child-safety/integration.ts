/**
 * Child Safety Integration V1 — web server boundary. Two surfaces:
 *   - MANAGEMENT (session-authenticated, tenant-scoped, permission-gated, same-origin for mutations):
 *     partner/application/installation/key/subject registry + receipts + local sandbox.
 *   - The GATEWAY itself is signature-authenticated and lives in its own route (no user session).
 * Maps results/errors to SAFE, stable JSON — never Prisma/stack/tenant/existence leakage. Tamanor never
 * accepts a private key; the sandbox generates an EPHEMERAL key in-memory (never persisted) to demo the loop.
 */
import {
  systemDb,
  type IntegrationActor, ChildSafetyIntegrationForbiddenError, ChildSafetyIntegrationNotFoundError, ChildSafetyIntegrationStateError,
  createIntegrationPartner, createIntegrationApplication, createIntegrationInstallation, registerIntegrationKey,
  startIntegrationKeyRotation, revokeIntegrationKey, setInstallationStatus, linkIntegrationSubject,
  listIntegrationPartners, getIntegrationInstallation, listIntegrationReceipts, processIntegrationSignal, runSandboxSignal,
} from "@guardora/db";
import { canViewChildSafetyIntegration, validateSignalEnvelope } from "@guardora/core";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";

export interface IntHttpResult { status: number; body: Record<string, unknown>; }
const ok = (body: Record<string, unknown>): IntHttpResult => ({ status: 200, body: { ok: true, ...body } });
const err = (status: number, code: string): IntHttpResult => ({ status, body: { ok: false, error: code } });
const MAX_BODY = 128 * 1024;
const GATEWAY_PATH = "/api/v1/child-safety/integrations/signals";

async function resolveActor(): Promise<{ actor: IntegrationActor } | { denied: IntHttpResult }> {
  const session = await getSession();
  if (!session || !session.emailVerified) return { denied: err(401, "unauthenticated") };
  if (!canViewChildSafetyIntegration(session.role)) return { denied: err(403, "forbidden") };
  const m = await systemDb.membership.findFirst({ where: { userId: session.userId, tenantId: session.tenantId }, select: { id: true } });
  if (!m) return { denied: err(403, "forbidden") };
  return { actor: { tenantId: session.tenantId, userId: session.userId, membershipId: m.id, role: session.role } };
}
function mapError(e: unknown): IntHttpResult {
  if (e instanceof ChildSafetyIntegrationForbiddenError) return err(403, "forbidden");
  if (e instanceof ChildSafetyIntegrationNotFoundError) return err(404, "not_found");
  if (e instanceof ChildSafetyIntegrationStateError) return err(409, e.code);
  return err(500, "internal");
}
const tooLarge = (b: unknown): boolean => { try { return JSON.stringify(b ?? {}).length > MAX_BODY; } catch { return true; } };

// ── Reads ─────────────────────────────────────────────────────────────────────
export async function integrationList(): Promise<IntHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok({ partners: await listIntegrationPartners(r.actor) }); } catch (e) { return mapError(e); }
}
export async function integrationInstallationGet(installationId: string): Promise<IntHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok({ installation: await getIntegrationInstallation(r.actor, installationId) }); } catch (e) { return mapError(e); }
}
export async function integrationReceipts(params: URLSearchParams): Promise<IntHttpResult> {
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  try { return ok(await listIntegrationReceipts(r.actor, { installationId: params.get("installationId") ?? undefined, resultCode: params.get("resultCode") ?? undefined, page: Number(params.get("page")) || 1, pageSize: Number(params.get("pageSize")) || undefined }) as unknown as Record<string, unknown>); } catch (e) { return mapError(e); }
}

// ── Mutations (same-origin) — action dispatch ─────────────────────────────────
export async function integrationAction(body: unknown): Promise<IntHttpResult> {
  if (!(await isSameOrigin())) return err(403, "forbidden");
  const r = await resolveActor(); if ("denied" in r) return r.denied;
  if (tooLarge(body)) return err(413, "too_large");
  const b = (body ?? {}) as Record<string, unknown>;
  const action = String(b.action ?? "");
  try {
    switch (action) {
      case "create_partner": return ok(await createIntegrationPartner(r.actor, { partnerKey: String(b.partnerKey ?? ""), displayName: String(b.displayName ?? "") }));
      case "create_application": return ok(await createIntegrationApplication(r.actor, String(b.partnerId ?? ""), { applicationKey: String(b.applicationKey ?? ""), displayName: String(b.displayName ?? ""), environment: typeof b.environment === "string" ? b.environment : undefined, capabilities: Array.isArray(b.capabilities) ? (b.capabilities as string[]) : undefined }));
      case "create_installation": return ok(await createIntegrationInstallation(r.actor, String(b.applicationId ?? ""), { installationKey: String(b.installationKey ?? "") }));
      case "register_key": return ok(await registerIntegrationKey(r.actor, String(b.installationId ?? ""), { publicKeyBase64: String(b.publicKeyBase64 ?? "") }));
      case "rotate_key": return ok(await startIntegrationKeyRotation(r.actor, String(b.keyId ?? "")));
      case "revoke_key": return ok(await revokeIntegrationKey(r.actor, String(b.keyId ?? "")));
      case "set_installation_status": {
        const s = String(b.status ?? ""); if (!["active", "suspended", "revoked"].includes(s)) return err(400, "bad_status");
        return ok(await setInstallationStatus(r.actor, String(b.installationId ?? ""), s as "active" | "suspended" | "revoked"));
      }
      case "link_subject": return ok(await linkIntegrationSubject(r.actor, String(b.installationId ?? ""), { pseudonymousSubjectId: String(b.pseudonymousSubjectId ?? ""), protectedProfileId: String(b.protectedProfileId ?? "") }));
      case "sandbox_validate": return ok({ validation: validateSignalEnvelope(b.envelope) });
      case "sandbox_send": return await sandboxSend(r.actor, b);
      default: return err(400, "unknown_action");
    }
  } catch (e) { return mapError(e); }
}

/**
 * LOCAL SANDBOX end-to-end. All crypto + the ephemeral key lifecycle live in the DB layer
 * ({@link runSandboxSignal}): sandbox-environment installations only, an in-memory ephemeral key (private
 * key never persisted/logged) that is REVOKED immediately after the send. Gated by sandbox_use.
 */
async function sandboxSend(actor: IntegrationActor, b: Record<string, unknown>): Promise<IntHttpResult> {
  const installationId = String(b.installationId ?? "");
  const s = (b.signal ?? {}) as Record<string, unknown>;
  try {
    const { keyVersion, result } = await runSandboxSignal(actor, installationId, {
      signalType: typeof s.signalType === "string" ? s.signalType : undefined,
      confidenceBand: typeof s.confidenceBand === "string" ? s.confidenceBand : undefined,
      severityHint: typeof s.severityHint === "string" ? s.severityHint : undefined,
      immediateDangerFlag: Boolean(s.immediateDangerFlag),
      pseudonymousSubjectId: typeof s.pseudonymousSubjectId === "string" ? s.pseudonymousSubjectId : undefined,
    });
    return ok({ sandbox: true, keyVersion, result: { code: result.code, httpStatus: result.httpStatus, canonicalSignalId: result.canonicalSignalId ?? null, receiptId: result.receiptId ?? null } });
  } catch (e) { return mapError(e); }
}

// ── GATEWAY handler (called by the no-session route) ──────────────────────────
export async function gatewayHandle(rawBody: string, headers: { signature: string | null; keyVersion: string | null; installation: string | null }): Promise<{ status: number; body: Record<string, unknown>; retryAfter?: number }> {
  const kv = headers.keyVersion ? Number(headers.keyVersion) : null;
  const result = await processIntegrationSignal({
    method: "POST", path: GATEWAY_PATH, rawBody,
    signatureBase64: headers.signature, keyVersion: Number.isFinite(kv) ? kv : null, installationIdHeader: headers.installation,
  });
  return {
    status: result.httpStatus,
    body: { ok: result.code === "SIGNAL_ACCEPTED" || result.code === "SIGNAL_DUPLICATE", code: result.code, ...(result.eventId ? { eventId: result.eventId } : {}), ...(result.receiptId ? { receiptId: result.receiptId } : {}), ...(result.canonicalSignalId ? { canonicalSignalId: result.canonicalSignalId } : {}) },
    retryAfter: result.retryAfterSeconds,
  };
}
