/**
 * META-EXTERNAL-ACCESS-V1 — Meta **Deauthorize** callback.
 *
 * Meta POSTs a form-encoded `signed_request` when a person removes Tamanor from their Facebook account. As with
 * the deletion callback there is no session and no trustworthy source IP, so the verified `signed_request` is
 * the ONLY authentication and a forged POST is rejected before any lookup or write.
 *
 * Deauthorization revokes the person's own grant, so Tamanor drops the one thing that grant created and that
 * the payload can authoritatively identify: the Facebook LOGIN link. It deliberately does NOT disconnect any
 * Page, Instagram account, credential, tenant or membership — a connected Page never records WHICH Meta user
 * authorised it, so acting on it here could destroy an unrelated customer's working integration. A Page whose
 * underlying token really did die is already detected truthfully by the existing token-health path and surfaces
 * as `needs_reconnect`.
 *
 * Idempotent and tenant-safe. Never logs or returns the signed request, the payload, the app secret or the
 * app-scoped user id.
 */
import { getMetaConfig } from "@guardora/config";
import { emitOpsEvent } from "@guardora/core";
import { verifyMetaSignedRequest } from "@guardora/connectors";
import { deleteFacebookLoginIdentity } from "@guardora/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readSignedRequest(req: Request): Promise<string | null> {
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { signed_request?: unknown };
      return typeof body?.signed_request === "string" ? body.signed_request : null;
    }
    const form = await req.formData();
    const value = form.get("signed_request");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const appSecret = getMetaConfig().appSecret;
  const verified = verifyMetaSignedRequest(await readSignedRequest(req), appSecret);

  if (!verified.ok) {
    emitOpsEvent("meta.deauthorize_rejected", { operation: "meta_deauthorize", reason: verified.reason });
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const res = await deleteFacebookLoginIdentity(verified.userId);
    emitOpsEvent("meta.deauthorize_completed", { operation: "meta_deauthorize", result: res.removed ? "removed" : "already_absent" });
  } catch {
    emitOpsEvent("meta.deauthorize_rejected", { operation: "meta_deauthorize", reason: "storage_error" });
    return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  }

  // Meta expects only an acknowledgement.
  return Response.json({ ok: true });
}
