/**
 * META-EXTERNAL-ACCESS-V1 — Meta **Data Deletion Request** callback.
 *
 * Meta POSTs a form-encoded `signed_request` when a person asks Facebook to delete the data an app holds about
 * them. There is no session, no bearer token and no trustworthy source IP, so the verified `signed_request` is
 * the ONLY authentication: a forged or unsigned POST is rejected before any lookup or write happens.
 *
 * Scope of the deletion is exactly what the callback can PROVE. The payload identifies an app-scoped user id,
 * whose single authoritative mapping in this system is the Facebook LOGIN link
 * (`OAuthAccount(provider="facebook")`). That link is removed. Nothing else is: not the Tamanor user (they may
 * sign in another way and belong to tenants with other members), and not any tenant, brand, membership,
 * connected Page, Instagram account, credential or business contact — a connected Page never records WHICH
 * Meta user authorised it, so it can never be attributed to this requester.
 *
 * Idempotent: the confirmation code is derived deterministically from the identity, so a replay returns the
 * same code and removes nothing further. Never logs or returns the signed request, the payload, the app secret
 * or the app-scoped user id.
 */
import { getMetaConfig } from "@guardora/config";
import { emitOpsEvent } from "@guardora/core";
import { verifyMetaSignedRequest, metaDeletionConfirmationCode } from "@guardora/connectors";
import { deleteFacebookLoginIdentity } from "@guardora/db";
import { abs } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read `signed_request` from either a form post (Meta's documented shape) or a JSON body. */
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
  const signed = await readSignedRequest(req);
  const verified = verifyMetaSignedRequest(signed, appSecret);

  if (!verified.ok) {
    // Bounded reason only — never the payload, signature or secret.
    emitOpsEvent("meta.data_deletion_rejected", { operation: "meta_data_deletion", reason: verified.reason });
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const confirmationCode = metaDeletionConfirmationCode(verified.userId, appSecret!);
  let removed = false;
  try {
    removed = (await deleteFacebookLoginIdentity(verified.userId)).removed;
  } catch {
    // A storage failure must not be reported to Meta as a completed deletion.
    emitOpsEvent("meta.data_deletion_rejected", { operation: "meta_data_deletion", reason: "storage_error" });
    return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  }

  // Safe audit: outcome label only. No app-scoped user id, no email, no tenant, no confirmation code.
  emitOpsEvent("meta.data_deletion_completed", { operation: "meta_data_deletion", result: removed ? "removed" : "already_absent" });

  // Exactly the response contract Meta requires — nothing more.
  return Response.json({
    url: abs(`/data-deletion?code=${encodeURIComponent(confirmationCode)}`),
    confirmation_code: confirmationCode,
  });
}
