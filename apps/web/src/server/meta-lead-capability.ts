/**
 * Server-side gatherer for the TRUTHFUL Meta Lead Ads readiness. Collects the real signals for a tenant and
 * delegates every decision to the pure `evaluateMetaLeadCapability` / `summarizeMetaLeadReadiness` (single
 * source of truth). Never claims the capability is available/active unless EVERY precondition genuinely holds.
 * A corrupt vault credential is treated as `credential_unavailable` (fail-closed), never silently "available".
 *
 * BUSINESS-LEADGEN-SUBSCRIPTION-V1 — the Page-level `leadgen` webhook subscription is one of those
 * preconditions. A Page that is not subscribed to this Meta app receives NO lead webhooks, so an unverified
 * subscription can never present as active (and `META_LEADS_APPROVED` does not stand in for it).
 *
 * BUSINESS-LEADGEN-MULTIPAGE-V1 — readiness is resolved PER Facebook Page. A tenant may connect several Pages,
 * each with its own granted permissions, vault credential and subscription; one "latest" account must never
 * speak for the rest. Only ACTIVE `facebook_page` accounts are subjects — an Instagram account is never
 * evaluated for Lead Ads and is never a subscription target.
 */
import "server-only";
import { getMetaConfig } from "@guardora/config";
import { systemDb, resolveMetaAccessToken } from "@guardora/db";
import {
  summarizeMetaLeadReadiness,
  type MetaLeadPageSignals, type MetaLeadReadinessSummary, type MetaLeadCapabilityState,
} from "@guardora/core";
import { LEADGEN_SUBSCRIPTION_VERIFIED } from "@guardora/sync";

/** The granted Graph permission required to read leads. */
const LEADS_PERMISSION = "leads_retrieval";
/** Live Meta App Review for lead retrieval is an out-of-band approval we do not have by default (truthful). */
function providerApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.META_LEADS_APPROVED ?? "").trim().toLowerCase() === "true";
}

/** The tenant's Lead Ads readiness: one record per active Facebook Page plus a truthful rollup. */
export type MetaLeadCapability = MetaLeadReadinessSummary;

export async function getMetaLeadCapability(tenantId: string, entitled: boolean): Promise<MetaLeadCapability> {
  const metaConfigured = getMetaConfig().configured;
  const tenant = { metaConfigured, entitled, providerApproved: providerApproved() };

  // EVERY trusted, active Facebook Page for this tenant — never Instagram, never a single "latest" row.
  // Stable ordering so the rendered list does not shuffle between requests.
  const accounts = await systemDb.connectedAccount.findMany({
    where: { tenantId, platform: "facebook_page" as never, status: "active" as never },
    select: {
      id: true, tenantId: true, externalName: true, grantedPermissions: true,
      longLivedToken: true, accessToken: true,
      leadgenSubscriptionStatus: true, leadgenSubscriptionCheckedAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Resolve each Page's vault credential independently and concurrently. A corrupt/unusable row fails CLOSED
  // for THAT Page only — it never downgrades another Page.
  const pages: MetaLeadPageSignals[] = await Promise.all(accounts.map(async (account) => {
    let credentialDecryptable = false;
    try {
      credentialDecryptable = (await resolveMetaAccessToken(account)) !== null;
    } catch {
      // VaultDecryptError (corrupt vault row) → fail-closed: not decryptable.
      credentialDecryptable = false;
    }
    return {
      connectedAccountId: account.id,
      displayName: account.externalName,
      // An ACTIVE connected account IS the live connection for that Page (unchanged semantics).
      connectionActive: true,
      credentialDecryptable,
      leadsPermissionGranted: Boolean(account.grantedPermissions?.includes(LEADS_PERMISSION)),
      // Fail-closed: only an explicitly VERIFIED subscription counts. NULL (never checked), `not_subscribed`,
      // and `unavailable` (the provider check failed — real state unknown) all mean "not verified".
      pageSubscriptionVerified: account.leadgenSubscriptionStatus === LEADGEN_SUBSCRIPTION_VERIFIED,
      subscriptionCheckedAt: account.leadgenSubscriptionCheckedAt,
    };
  }));

  return summarizeMetaLeadReadiness(tenant, pages);
}

/** Back-compat convenience: the single headline state. */
export async function getMetaLeadCapabilityState(tenantId: string, entitled: boolean): Promise<MetaLeadCapabilityState> {
  return (await getMetaLeadCapability(tenantId, entitled)).overall;
}
