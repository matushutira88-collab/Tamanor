import { findActiveMetaAccounts } from "@guardora/db";
import { syncMetaAccountState } from "@guardora/sync";
import { log } from "./logger";

/**
 * V1.38 — Meta connector health monitor. SYSTEM discovery finds active Meta accounts
 * (Facebook Page + Instagram) and hands each a trusted tenantId to the tenant-scoped
 * `syncMetaAccountState`, which does the real read → provider HTTP → write detection of
 * expired tokens / revoked permissions / deleted Pages / disconnected Instagram /
 * ownership changes.
 *
 * GATED OFF by default: it performs REAL Graph reads, so it only runs when
 * META_CONNECTOR_HEALTH=true (production/staging with real connectors). Off → no-op,
 * so the placeholder-connector invariant (no real API calls) holds by default.
 */
export async function runMetaConnectorHealth(): Promise<{ enabled: boolean; checked: number; changed: number }> {
  if ((process.env.META_CONNECTOR_HEALTH ?? "").trim() !== "true") {
    return { enabled: false, checked: 0, changed: 0 };
  }
  const accounts = await findActiveMetaAccounts();
  let changed = 0;
  for (const a of accounts) {
    try {
      const res = await syncMetaAccountState(a.tenantId, a.id);
      if (res.changed) changed++;
    } catch (err) {
      log.error("meta_health.account_failed", { accountId: a.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { enabled: true, checked: accounts.length, changed };
}
