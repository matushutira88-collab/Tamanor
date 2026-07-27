/**
 * Platform Admin V1 — import-safe API dispatch (no Next `server-only` / session dependency, so it is unit-
 * testable). Strict bounded parsing, safe error mapping (no raw DB/stack leakage, anti-enumeration), and
 * delegation to the platform-admin service (which resolves the platform role FRESH and enforces owner-only
 * management + last-owner protection + recent-auth). The route wrapper resolves the session actor + same-origin.
 */
import {
  addPlatformAdministrator, changePlatformRole, deactivatePlatformAccess, reactivatePlatformAccess,
  isPlatformForbidden, PlatformAdminError,
} from "@guardora/db";

export interface AdminHttpResult { status: number; body: Record<string, unknown>; }
const ok = (b: Record<string, unknown> = {}): AdminHttpResult => ({ status: 200, body: { ok: true, ...b } });
const err = (status: number, code: string): AdminHttpResult => ({ status, body: { ok: false, error: code } });

function mapError(e: unknown): AdminHttpResult {
  if (isPlatformForbidden(e)) return err(403, "forbidden");
  if (e instanceof PlatformAdminError) {
    const code = e.code;
    if (code === "stale_privileged_auth") return err(401, "reauth_required");
    if (code === "user_not_found") return err(404, "not_found"); // bounded, non-enumerating
    if (code === "unsupported_role" || code === "cannot_self_manage" || code === "last_owner_protected" || code === "version_conflict") return err(409, code);
    return err(400, "bad_request");
  }
  return err(500, "internal");
}
const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

export interface AdminActor { userId: string; authenticatedAt: Date | null; }

/** Dispatch a platform-administrator mutation. All permission/last-owner/recent-auth rules live in the service. */
export async function platformAdminMutation(actor: AdminActor, body: unknown): Promise<AdminHttpResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const action = String(b.action ?? "");
  const opts = { authenticatedAt: actor.authenticatedAt };
  try {
    switch (action) {
      case "add_admin": {
        const email = str(b.email), role = str(b.role, 24);
        if (!email || !role) return err(400, "bad_input");
        return ok(await addPlatformAdministrator(actor.userId, email, role, opts));
      }
      case "change_role": {
        const targetUserId = str(b.targetUserId), role = str(b.role, 24);
        if (!targetUserId || !role) return err(400, "bad_input");
        return ok(await changePlatformRole(actor.userId, targetUserId, role, { ...opts, expectedUpdatedAt: (b.expectedUpdatedAt as string | null | undefined) ?? undefined }));
      }
      case "deactivate": {
        const targetUserId = str(b.targetUserId);
        if (!targetUserId) return err(400, "bad_input");
        return ok(await deactivatePlatformAccess(actor.userId, targetUserId, opts));
      }
      case "reactivate": {
        const targetUserId = str(b.targetUserId);
        if (!targetUserId) return err(400, "bad_input");
        return ok(await reactivatePlatformAccess(actor.userId, targetUserId, opts));
      }
      default: return err(400, "unknown_action");
    }
  } catch (e) { return mapError(e); }
}
