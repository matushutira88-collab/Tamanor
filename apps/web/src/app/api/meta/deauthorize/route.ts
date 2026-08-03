/**
 * META-EXTERNAL-ACCESS-V2 — Meta **Deauthorize** callback.
 *
 * Meta POSTs a form-encoded `signed_request` when a person removes Tamanor from their Facebook account. As
 * with the deletion callback the verified `signed_request` is the ONLY authentication, and a forged, tampered,
 * stale or unsigned POST is rejected with 400 before any lookup or write.
 *
 * The grant is withdrawn, so everything it authorises must stop working. `revokeMetaAuthorization` revokes
 * every ACTIVE Meta credential whose CURRENT authorization provenance is that identity, marks the owning
 * Facebook Page / Instagram accounts `needs_reconnect`, and removes the Facebook login link only afterwards —
 * so a crash mid-way can never leave a usable credential behind. No provider HTTP is needed: the invalidation
 * is entirely local and takes effect immediately because a revoked vault row is never downgraded to a legacy
 * column read.
 *
 * Untouched: the tenant's contacts, comments and business records; the connected account rows themselves
 * (kept but unusable until an authorised person reconnects); the Tamanor user, memberships and tenants; and
 * any credential whose provenance is a DIFFERENT Meta identity — including a Page whose credential was later
 * replaced by another authorised person, which a stale callback from the first person must not kill.
 *
 * Idempotent and replay-safe. Never logs or returns the signed request, payload, app secret or user id.
 */
import { getMetaConfig } from "@guardora/config";
import { emitOpsEvent } from "@guardora/core";
import { verifyMetaSignedRequest } from "@guardora/connectors";
import { revokeMetaAuthorization } from "@guardora/db";

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
    const outcome = await revokeMetaAuthorization(verified.userId);
    // Counts are intentionally NOT emitted — only a bounded outcome label.
    emitOpsEvent("meta.deauthorize_completed", { operation: "meta_deauthorize", result: outcome.alreadyClean ? "already_absent" : "revoked" });
  } catch {
    emitOpsEvent("meta.deauthorize_rejected", { operation: "meta_deauthorize", reason: "storage_error" });
    return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  }

  // Meta expects only an acknowledgement.
  return Response.json({ ok: true });
}
