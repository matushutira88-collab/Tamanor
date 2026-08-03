/**
 * META-EXTERNAL-ACCESS-V2 — what Tamanor does when Meta sends a deauthorize or data-deletion callback.
 *
 * Meta's callbacks identify the requester only by an **app-scoped user id**. Two things are authoritatively
 * linked to that id:
 *
 *   1. `OAuthAccount(provider="facebook", providerAccountId)` — the Facebook *Login* link, unique on the pair.
 *   2. `ProviderCredential.authorizingProviderUserId` — CREDENTIAL AUTHORIZATION PROVENANCE: the identity
 *      whose OAuth grant produced the credential CURRENTLY stored for a Page / Instagram account. Written
 *      server-side on every store/rotate, so a reconnect by another authorised person replaces it.
 *
 * Withdrawing a grant must actually stop Tamanor using it. So the callback REVOKES every active Meta
 * credential whose current provenance is that identity, and marks the owning connected accounts
 * `needs_reconnect` — after which `resolveMetaAccessToken` fails closed (a revoked vault row is never
 * downgraded to a legacy column read), so comment sync, moderation and Lead Ads fetching all stop.
 *
 * DELIBERATELY PRESERVED — the tenant's own business records are not the requester's data:
 *   • business contacts / leads, reputation items, comments, audit history;
 *   • the ConnectedAccount rows themselves (kept, but unusable until someone reconnects);
 *   • the Tamanor user account, memberships, tenants and brands;
 *   • any credential whose provenance is a DIFFERENT Meta identity — including a Page whose credential was
 *     later replaced by another authorised person, which a stale callback from the first person must not kill.
 *
 * Credentials written before provenance existed carry NULL and are NOT attributable to anyone; they are never
 * touched by a callback and can only be cleared by an explicit in-product disconnect.
 *
 * Idempotent and replay-safe: a repeated callback finds no active attributable credential and changes nothing.
 * Runs on the SYSTEM client — the callback is pre-tenant and authenticated by the verified `signed_request`.
 */
import { BusinessProvider } from "@prisma/client";
import { prisma as systemDb } from "./index";

/** The Login provider key for Facebook. USER sign-in only — never the Page/Business connector. */
export const FACEBOOK_LOGIN_PROVIDER = "facebook";
/** Reason stamped on an account whose credential was withdrawn by its authorising Meta identity. */
export const PROVIDER_DEAUTHORIZED_REASON = "provider_deauthorized";

export interface MetaIdentityRevocationResult {
  /** Active Meta credentials revoked by THIS call. */
  credentialsRevoked: number;
  /** Connected accounts marked as requiring reconnect by THIS call. */
  accountsInvalidated: number;
  /** True when the Facebook login link existed and was removed by THIS call. */
  loginLinkRemoved: boolean;
  /** True when nothing was attributable to this identity — a replay, or an identity Tamanor never held. */
  alreadyClean: boolean;
}

/**
 * Invalidate everything the given Meta identity's grant currently authorises, then drop the login link.
 *
 * Order matters: credentials are revoked and accounts downgraded FIRST, and the `OAuthAccount` mapping is
 * removed only afterwards, so a crash mid-way can never leave a usable credential behind with the mapping
 * already gone. Every step is idempotent, so the retry simply completes the remainder.
 *
 * Never throws for a missing row. Returns counts only — no provider id, account id, tenant id or token.
 */
export async function revokeMetaAuthorization(providerUserId: string, now: Date = new Date()): Promise<MetaIdentityRevocationResult> {
  const id = typeof providerUserId === "string" ? providerUserId.trim() : "";
  if (!id) return { credentialsRevoked: 0, accountsInvalidated: 0, loginLinkRemoved: false, alreadyClean: true };

  // 1) Every ACTIVE Meta credential whose CURRENT provenance is this identity. A NULL provenance never
  //    matches, so a pre-provenance or third-party credential can never be swept up here.
  const credentials = await systemDb.providerCredential.findMany({
    where: {
      provider: BusinessProvider.meta,
      authorizingProviderUserId: id,
      revokedAt: null,
    },
    select: { id: true, connectedAccountId: true },
  });

  let credentialsRevoked = 0;
  if (credentials.length > 0) {
    const res = await systemDb.providerCredential.updateMany({
      where: { id: { in: credentials.map((c) => c.id) }, revokedAt: null },
      data: { revokedAt: now },
    });
    credentialsRevoked = res.count;
  }

  // 2) Downgrade the owning connected accounts so no provider call can be attempted with the withdrawn grant.
  //    The rows are KEPT (the tenant's configuration, monitoring settings and history survive) — they are
  //    simply unusable until an authorised person reconnects. A row the user already disconnected is skipped.
  const accountIds = [...new Set(credentials.map((c) => c.connectedAccountId).filter((v): v is string => Boolean(v)))];
  let accountsInvalidated = 0;
  if (accountIds.length > 0) {
    const res = await systemDb.connectedAccount.updateMany({
      where: { id: { in: accountIds }, status: { not: "disconnected" as never } },
      data: {
        connectionStatus: "needs_reconnect",
        tokenHealth: "revoked",
        health: "error" as never,
        requiresReconnectReason: PROVIDER_DEAUTHORIZED_REASON,
        lastTokenCheckAt: now,
        lastTokenCheckResult: PROVIDER_DEAUTHORIZED_REASON,
      },
    });
    accountsInvalidated = res.count;
  }

  // 3) ONLY NOW drop the login mapping. Unique on (provider, providerAccountId), so it can match at most one
  //    row, and `OAuthAccount` is a leaf — removing it leaves the user, memberships and tenants untouched.
  const link = await systemDb.oAuthAccount.deleteMany({
    where: { provider: FACEBOOK_LOGIN_PROVIDER, providerAccountId: id },
  });

  return {
    credentialsRevoked,
    accountsInvalidated,
    loginLinkRemoved: link.count > 0,
    alreadyClean: credentialsRevoked === 0 && accountsInvalidated === 0 && link.count === 0,
  };
}
