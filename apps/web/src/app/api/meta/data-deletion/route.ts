/**
 * META-EXTERNAL-ACCESS-V2 — Meta **Data Deletion Request** callback.
 *
 * Meta POSTs a form-encoded `signed_request` when a person asks Facebook to delete the data an app holds about
 * them. There is no session, no bearer token and no trustworthy source IP, so the verified `signed_request` is
 * the ONLY authentication: a forged, tampered, stale or unsigned POST is rejected with 400 before any lookup
 * or write.
 *
 * Withdrawing a grant must actually stop Tamanor using it, so this performs the SAME invalidation as
 * deauthorization: every active Meta credential whose CURRENT authorization provenance is that identity is
 * revoked, its connected accounts are marked `needs_reconnect`, and only then is the Facebook login link
 * removed. After that `resolveMetaAccessToken` fails closed for those accounts, so comment sync, moderation
 * and Lead Ads fetching all stop.
 *
 * It does NOT delete the tenant's own business records — contacts, comments, reputation items, the connected
 * account rows, the Tamanor user, memberships or tenants. Those are the customer's data, not the requester's:
 * a Page-owned lead was captured by the Page's own form, and claiming it belongs to the authorising Facebook
 * user would be false. Credentials authorised by a DIFFERENT Meta identity are never touched.
 *
 * Idempotent: the confirmation code is derived deterministically from the identity, so a replay returns the
 * same code and changes nothing further. Never logs or returns the signed request, the payload, the app
 * secret, the app-scoped user id or any count that could identify a tenant.
 */
import { getMetaConfig } from "@guardora/config";
import { emitOpsEvent } from "@guardora/core";
import { verifyMetaSignedRequest, metaDeletionConfirmationCode } from "@guardora/connectors";
import { revokeMetaAuthorization } from "@guardora/db";
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
  let outcome: Awaited<ReturnType<typeof revokeMetaAuthorization>>;
  try {
    outcome = await revokeMetaAuthorization(verified.userId);
  } catch {
    // A storage failure must not be reported to Meta as a completed deletion.
    emitOpsEvent("meta.data_deletion_rejected", { operation: "meta_data_deletion", reason: "storage_error" });
    return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  }

  // Safe audit: outcome label only. No app-scoped user id, no email, no tenant, no confirmation code.
  emitOpsEvent("meta.data_deletion_completed", { operation: "meta_data_deletion", result: outcome.alreadyClean ? "already_absent" : "revoked" });

  // Exactly the response contract Meta requires — nothing more.
  return Response.json({
    url: abs(`/data-deletion?code=${encodeURIComponent(confirmationCode)}`),
    confirmation_code: confirmationCode,
  });
}
