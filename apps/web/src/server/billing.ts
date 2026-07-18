import "server-only";
import { cache } from "react";
import { getTenantBilling as _getTenantBilling, getTenantEntitlements as _getTenantEntitlements } from "@guardora/db";

/**
 * V1.60 — REQUEST-SCOPED memoization of the tenant billing + entitlement reads. The dashboard layout and
 * several pages (billing, usage) both read the same tenant row in one render; React `cache()` collapses
 * those duplicate reads to a single DB query per request. Same pattern as the memoized session holder.
 * Tenant isolation is unchanged — the tenantId argument is part of the cache key and every underlying
 * read is still tenant-scoped.
 */
export const getTenantBilling = cache(_getTenantBilling);
export const getTenantEntitlements = cache(_getTenantEntitlements);
