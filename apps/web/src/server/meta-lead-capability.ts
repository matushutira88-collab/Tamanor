/**
 * Server-side gatherer for the TRUTHFUL Meta Lead Ads capability state. Collects the real signals for a tenant
 * and delegates the decision to the pure `evaluateMetaLeadCapability` (single source of truth). Never claims the
 * capability is available/active unless EVERY precondition genuinely holds. A corrupt vault credential is treated
 * as `credential_unavailable` (fail-closed), never silently "available".
 */
import "server-only";
import { getMetaConfig } from "@guardora/config";
import { systemDb, resolveMetaAccessToken } from "@guardora/db";
import { evaluateMetaLeadCapability, type MetaLeadCapabilityState } from "@guardora/core";

/** The granted Graph permission required to read leads. */
const LEADS_PERMISSION = "leads_retrieval";
/** Live Meta App Review for lead retrieval is an out-of-band approval we do not have by default (truthful). */
function providerApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.META_LEADS_APPROVED ?? "").trim().toLowerCase() === "true";
}

export async function getMetaLeadCapabilityState(tenantId: string, entitled: boolean): Promise<MetaLeadCapabilityState> {
  const metaConfigured = getMetaConfig().configured;

  // The trusted, active Meta page account for this tenant (with the fields needed to check credential + permission).
  const account = await systemDb.connectedAccount.findFirst({
    where: { tenantId, platform: "facebook_page" as never, status: "active" as never },
    select: { id: true, tenantId: true, grantedPermissions: true, longLivedToken: true, accessToken: true },
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

  return evaluateMetaLeadCapability({
    metaConfigured,
    entitled,
    hasLinkedActiveAccount,
    connectionActive,
    credentialDecryptable,
    leadsPermissionGranted,
    providerApproved: providerApproved(),
  });
}
