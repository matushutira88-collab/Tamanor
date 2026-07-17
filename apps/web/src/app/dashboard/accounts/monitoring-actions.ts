"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan, EntitlementError, emitOpsEvent } from "@guardora/core";
import { enableAccountMonitoringWithinLimit, setAccountMonitoring } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";

/**
 * V1.59 — toggle whether Guardora monitors an account. ENABLE goes through the ATOMIC monitored-account
 * limit (enableAccountMonitoringWithinLimit) so the plan limit can never be bypassed — FB Page and IG
 * each count as one. All DB writes are tenant-scoped (RLS) so a user can only ever toggle their own
 * accounts; ConnectorManage permission + same-origin are also required.
 */
export async function toggleMonitoringAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  if (!(await isSameOrigin())) redirect("/dashboard/accounts?error=csrf");

  const accountId = String(formData.get("accountId") ?? "");
  const enable = String(formData.get("enable") ?? "") === "true";
  if (!accountId) redirect("/dashboard/accounts");

  try {
    if (enable) {
      await enableAccountMonitoringWithinLimit(session.tenantId, accountId); // atomic — never over-allocates
      emitOpsEvent("account.monitoring_enabled", { operation: "toggle" });
    } else {
      await setAccountMonitoring(session.tenantId, accountId, false);
      emitOpsEvent("account.monitoring_disabled", { operation: "toggle" });
    }
  } catch (e) {
    if (e instanceof EntitlementError) {
      emitOpsEvent("subscription.account_limit_reached", { operation: "enable_monitoring" });
      redirect("/dashboard/accounts?error=account_limit_reached");
    }
    throw e;
  }
  revalidatePath("/dashboard/accounts");
  redirect("/dashboard/accounts?ok=monitoring");
}
