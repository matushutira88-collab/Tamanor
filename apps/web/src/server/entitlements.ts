import "server-only";
import { getTenantEntitlements, tenantAllowsOperations } from "@guardora/db";
import { isWithinLimit, EntitlementError, emitOpsEvent, type EntitlementReason, type GatedOperation } from "@guardora/core";

/**
 * V1.50E — server-side entitlement gates used by dashboard actions. The single central catalogue
 * (@guardora/core entitlements) is authoritative; these helpers apply it with the tenant's trusted
 * plan + access state (no client-supplied plan/count). Denials are normalized reason codes, never
 * raw exceptions, and emit bounded PII-free ops events.
 */

/**
 * Throwing gate for OPERATIONS (moderation/provider execution, sync). A restricted/suspended or
 * deleting tenant is denied — this is the server-side enforcement behind any UI block ("no
 * UI-only protection"). Throws {@link EntitlementError} with reason `billing_restricted`.
 */
export async function assertTenantOperationAllowed(tenantId: string, op: GatedOperation): Promise<void> {
  if (!(await tenantAllowsOperations(tenantId))) {
    emitOpsEvent("entitlement.restricted_blocked", { operation: op, reason: "billing_restricted" });
    throw new EntitlementError("billing_restricted");
  }
}

/**
 * Non-throwing creation-limit check. `current` is the server-counted resource count (never a client
 * value). Returns a normalized reason to redirect with, or null when creation is allowed. Restricted
 * tenants have their limit forced to 0 (blocked) by the central resolver.
 */
export async function checkCreationLimit(tenantId: string, kind: "brand" | "account", current: number): Promise<EntitlementReason | null> {
  const ent = await getTenantEntitlements(tenantId);
  const max = kind === "brand" ? ent.maxBrands : ent.maxConnectedAccounts;
  if (isWithinLimit(current, max)) return null;
  const reason: EntitlementReason = kind === "brand" ? "brand_limit_reached" : "account_limit_reached";
  emitOpsEvent("entitlement.limit_reached", { operation: kind === "brand" ? "create_brand" : "connect_account", plan: ent.plan, reason });
  return reason;
}
