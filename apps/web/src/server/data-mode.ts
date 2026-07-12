import "server-only";
import { getDataMode } from "@guardora/config";
import { withTenantDb } from "@guardora/db";

/** The real Konfigurátor Facebook Page — never treated as demo, never deleted. */
export const PROTECTED_REAL_PAGE_ID = "1165524636643112";

export interface RealModeFilter {
  mode: "real" | "demo";
  /** True when GUARDORA_DATA_MODE=real. */
  isRealMode: boolean;
  /** Brand ids that have a real (active, non-mock) connected account. */
  realBrandIds: string[];
  /**
   * Prisma `where` fragment to scope reputation queries. Empty in demo mode; in
   * real mode restricts to real brands (or an impossible id when none exist so
   * demo data never leaks into a real test).
   */
  brandWhere: Record<string, unknown>;
  /** In real mode: are there any real brands to show? */
  hasRealData: boolean;
}

/**
 * Compute the data-mode filter for a tenant. In `real` mode, only brands with a
 * real (active) connected account — or the protected Konfigurátor Page — count as
 * real; demo/mock brands are excluded from dashboards/inbox/accounts.
 */
export async function getRealModeFilter(tenantId: string): Promise<RealModeFilter> {
  const mode = getDataMode();
  if (mode !== "real") {
    return { mode, isRealMode: false, realBrandIds: [], brandWhere: {}, hasRealData: true };
  }

  const realAccounts = await withTenantDb(tenantId, (db) => db.connectedAccount.findMany({
    where: {
      tenantId,
      OR: [{ status: "active" }, { pageId: PROTECTED_REAL_PAGE_ID }],
    },
    select: { brandId: true },
  }));
  const realBrandIds = [...new Set(realAccounts.map((a) => a.brandId))];
  const hasRealData = realBrandIds.length > 0;

  return {
    mode,
    isRealMode: true,
    realBrandIds,
    // `in: []` matches nothing → demo data never shows in a real test.
    brandWhere: { brandId: { in: hasRealData ? realBrandIds : ["__no_real_brand__"] } },
    hasRealData,
  };
}
