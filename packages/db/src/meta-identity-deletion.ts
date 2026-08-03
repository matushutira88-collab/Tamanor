/**
 * META-EXTERNAL-ACCESS-V1 — the ONLY authoritative action Tamanor can take on a Meta data-deletion or
 * deauthorize callback.
 *
 * Meta's callbacks identify the requester by an **app-scoped user id** and nothing else. The single place that
 * id is authoritatively mapped in this system is `OAuthAccount(provider="facebook", providerAccountId=<id>)`
 * — the Facebook *Login* link created when a person signs in with Facebook. That row is unique on
 * `(provider, providerAccountId)`, so the mapping is exact.
 *
 * DELIBERATELY NOT DELETED — nothing below this line touches any of it:
 *   • the Tamanor user account (they may sign in by password/Google and belong to tenants with other members),
 *   • any tenant, brand, membership, connected Page, Instagram account, credential or business contact.
 *
 * A connected Facebook Page (`ConnectedAccount`) records the Page, NOT which Meta user authorised it, so a Page
 * can NEVER be authoritatively attributed to the requesting identity. Deleting one on this signal would destroy
 * another customer's working integration. The scope here is exactly what the callback can prove.
 *
 * Runs on the SYSTEM client: the callback is unauthenticated-by-design (it is authenticated by the verified
 * `signed_request`) and pre-tenant, exactly like the Meta webhook ledger. It is idempotent — a repeated or
 * replayed callback for the same identity removes nothing further and reports the same outcome shape.
 */
import { prisma as systemDb } from "./index";

/** The Login provider key for Facebook. USER sign-in only — never the Page/Business connector. */
export const FACEBOOK_LOGIN_PROVIDER = "facebook";

export interface MetaIdentityDeletionResult {
  /** True when a Facebook login link existed for this app-scoped id and was removed by THIS call. */
  removed: boolean;
  /**
   * True when no link existed. Either it was already removed by an earlier callback (idempotent replay) or the
   * identity never signed in to Tamanor with Facebook. Both are a successful, complete outcome.
   */
  alreadyAbsent: boolean;
}

/**
 * Remove the Facebook LOGIN identity link for one app-scoped Meta user id.
 *
 * Scoped by the unique `(provider, providerAccountId)` pair, so it can match at most ONE row and can never
 * cascade: `OAuthAccount` is a leaf whose only relation is `user` with `onDelete: Cascade` pointing AT it (the
 * user owns the link, not the reverse), so removing it leaves the user, their memberships and every tenant
 * untouched. Never throws for a missing row.
 */
export async function deleteFacebookLoginIdentity(providerAccountId: string): Promise<MetaIdentityDeletionResult> {
  const id = typeof providerAccountId === "string" ? providerAccountId.trim() : "";
  if (!id) return { removed: false, alreadyAbsent: true };
  const res = await systemDb.oAuthAccount.deleteMany({
    where: { provider: FACEBOOK_LOGIN_PROVIDER, providerAccountId: id },
  });
  return { removed: res.count > 0, alreadyAbsent: res.count === 0 };
}
