/**
 * Server-side gatherer for the TRUTHFUL Meta Lead Ads capability state. Collects the real signals for a tenant
 * and delegates the decision to the pure `evaluateMetaLeadCapability` (single source of truth). Never claims the
 * capability is available/active unless EVERY precondition genuinely holds. A corrupt vault credential is treated
 * as `credential_unavailable` (fail-closed), never silently "available".
 *
 * BUSINESS-LEADGEN-SUBSCRIPTION-V1 — the Page-level `leadgen` webhook subscription is one of those preconditions.
 * A Page that is not subscribed to this Meta app receives NO lead webhooks, so an unverified subscription can
 * never present as active (and `META_LEADS_APPROVED` does not stand in for it).
 */
import "server-only";
import { getMetaConfig } from "@guardora/config";
import { systemDb, resolveMetaAccessToken } from "@guardora/db";
import { evaluateMetaLeadCapability, type MetaLeadCapabilityState } from "@guardora/core";
import { LEADGEN_SUBSCRIPTION_VERIFIED } from "@guardora/sync";

/** The granted Graph permission required to read leads. */
const LEADS_PERMISSION = "leads_retrieval";
/** Live Meta App Review for lead retrieval is an out-of-band approval we do not have by default (truthful). */
function providerApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.META_LEADS_APPROVED ?? "").trim().toLowerCase() === "true";
}

/** The capability state plus the Page account it was derived from (needed to offer the webhook repair action). */
export interface MetaLeadCapability {
  state: MetaLeadCapabilityState;
  /** The active Facebook Page account id, when one exists. NEVER an Instagram account. */
  pageAccountId: string | null;
}

export async function getMetaLeadCapability(tenantId: string, entitled: boolean): Promise<MetaLeadCapability> {
  const metaConfigured = getMetaConfig().configured;

  // The trusted, active Meta page account for this tenant (with the fields needed to check credential + permission
  // + the last VERIFIED Page-level leadgen webhook subscription).
  const account = await systemDb.connectedAccount.findFirst({
    where: { tenantId, platform: "facebook_page" as never, status: "active" as never },
    select: { id: true, tenantId: true, grantedPermissions: true, longLivedToken: true, accessToken: true, leadgenSubscriptionStatus: true },
    orderBy: { updatedAt: "desc" },
  });
  const hasLinkedActiveAccount = Boolean(account);

  // An explicit BusinessPlatformConnection may also gate; account presence already implies a live connection.
  const conn = await systemDb.businessPlatformConnection.findFirst({ where: { tenantId, provider: "meta" as never }, select: { status: true } });
  const connectionActive = hasLinkedActiveAccount || conn?.status === "active";

  let credentialDecryptable = false;
  if (account) {
    try {
      credentialDecryptable = (await resolveMetaAccessToken(account)) !== null;
    } catch {
      // VaultDecryptError (corrupt vault row) → fail-closed: not decryptable.
      credentialDecryptable = false;
    }
  }

  const leadsPermissionGranted = Boolean(account?.grantedPermissions?.includes(LEADS_PERMISSION));
  // Fail-closed: only an explicitly VERIFIED subscription counts. NULL (never checked), `not_subscribed`, and
  // `unavailable` (the provider check failed — real state unknown) all mean "not verified".
  const pageSubscriptionVerified = account?.leadgenSubscriptionStatus === LEADGEN_SUBSCRIPTION_VERIFIED;

  const state = evaluateMetaLeadCapability({
    metaConfigured,
    entitled,
    hasLinkedActiveAccount,
    connectionActive,
    credentialDecryptable,
    leadsPermissionGranted,
    pageSubscriptionVerified,
    providerApproved: providerApproved(),
  });
  return { state, pageAccountId: account?.id ?? null };
}

/** Back-compat convenience: the state alone. */
export async function getMetaLeadCapabilityState(tenantId: string, entitled: boolean): Promise<MetaLeadCapabilityState> {
  return (await getMetaLeadCapability(tenantId, entitled)).state;
}
