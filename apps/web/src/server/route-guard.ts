import "server-only";
import { getTenantEntitlements } from "@guardora/db";
import { hasEntitlement, emitOpsEvent, metrics, type PlanEntitlements, type BooleanFeature } from "@guardora/core";
import { requireVerifiedSession, type AppSession } from "./auth";

/**
 * V1.50F — the SINGLE server-side dashboard route guard. Combines a verified session + the tenant's
 * trusted plan entitlements (which already fold in tenant-activity + billing access state) and
 * decides capability access. Never trusts a client-supplied plan/role/tenant/entitlement. Growth-
 * only routes call this; if the plan lacks the capability the page renders a truthful LOCKED state
 * (not a 404) and runs NO data query — so a direct URL cannot bypass the plan restriction.
 */
export type CapabilityLock = { capability: BooleanFeature; plan: string; reason: "feature_not_in_plan" | "plan_upgrade_required" };
export type CapabilityAccess =
  | { allowed: true; session: AppSession; ent: PlanEntitlements }
  | { allowed: false; session: AppSession; ent: PlanEntitlements; locked: CapabilityLock };

export async function requireDashboardCapability(capability: BooleanFeature): Promise<CapabilityAccess> {
  const session = await requireVerifiedSession();
  const ent = await getTenantEntitlements(session.tenantId);
  if (hasEntitlement(ent, capability)) return { allowed: true, session, ent };
  metrics.inc("route_capability_denied_total", { capability, plan: ent.plan });
  emitOpsEvent("route.capability_denied", { capability, plan: ent.plan, reason: "feature_not_in_plan" });
  return { allowed: false, session, ent, locked: { capability, plan: ent.plan, reason: "plan_upgrade_required" } };
}
