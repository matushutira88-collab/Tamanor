"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import { getLiveActionsConfig } from "@guardora/config";
import { rollbackHide } from "@guardora/sync";
import { withTenant } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

/**
 * V1.27 Production Safe Mode — kill switches + rollback server actions. Kill
 * switches are the operator's immediate stop; rollback ("restore comment") undoes
 * a previously executed hide. Both are audited; tokens are never logged.
 */

/** Per-brand kill switch. When on, no live action runs for the brand. */
export async function toggleBrandKillSwitch(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);
  const brandId = String(formData.get("brandId") ?? "");
  const on = formData.get("on") === "1";
  await withTenant(session.tenantId, async (db) => {
    const brand = await db.brand.findFirst({ where: { id: brandId, tenantId: session.tenantId }, select: { id: true } });
    if (!brand) throw new Error("Brand not found");
    await db.brand.update({ where: { id: brand.id }, data: { killSwitch: on } });
    await writeAudit({ session, db, event: on ? "kill_switch.enabled" : "kill_switch.disabled", brandId, targetType: "brand", targetId: brandId, metadata: { scope: "brand", on } });
  });
  revalidatePath("/dashboard/control-center");
  redirect(`/dashboard/control-center?kind=ok&notice=${encodeURIComponent(on ? "Live actions stopped for this brand." : "Live actions resumed for this brand.")}`);
}

/**
 * Enable/disable safe autonomous auto-hide for a brand (Production Safe Mode
 * per-brand opt-in). Upserts BrandLiveSafetySettings; enabling requires an explicit
 * acknowledgement (checked client-side and re-checked here). Safety limits + the
 * hard floor still apply on every hide.
 */
export async function setBrandAutoHide(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);
  const brandId = String(formData.get("brandId") ?? "");
  const on = formData.get("on") === "1";
  const acknowledged = formData.get("ack") === "on" || formData.get("ack") === "true";

  const brand = await withTenant(session.tenantId, (db) => db.brand.findFirst({ where: { id: brandId, tenantId: session.tenantId }, select: { id: true } }));
  if (!brand) throw new Error("Brand not found");
  if (on && !acknowledged) {
    redirect(`/dashboard/control-center?kind=error&notice=${encodeURIComponent("Please confirm you understand comments will be hidden automatically.")}`);
  }
  await withTenant(session.tenantId, async (db) => {
    await db.brandLiveSafetySettings.upsert({
      where: { brandId },
      create: { tenantId: session.tenantId, brandId, liveModeEnabled: on, autonomousHideEnabled: on },
      update: { liveModeEnabled: on, autonomousHideEnabled: on },
    });
    await writeAudit({ session, db, event: on ? "live_safety.enabled" : "live_safety.disabled", brandId, targetType: "brand", targetId: brandId, metadata: { autonomousHideEnabled: on } });
  });
  revalidatePath("/dashboard/control-center");
  redirect(`/dashboard/control-center?kind=ok&notice=${encodeURIComponent(on ? "Safe auto-hide enabled for this brand." : "Safe auto-hide disabled for this brand.")}`);
}

/** Per-account kill switch. When on, no live action runs for the account. */
export async function toggleAccountKillSwitch(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);
  const accountId = String(formData.get("accountId") ?? "");
  const on = formData.get("on") === "1";
  await withTenant(session.tenantId, async (db) => {
    const acct = await db.connectedAccount.findFirst({ where: { id: accountId, tenantId: session.tenantId }, select: { id: true, brandId: true } });
    if (!acct) throw new Error("Account not found");
    await db.connectedAccount.update({ where: { id: acct.id }, data: { killSwitch: on } });
    await writeAudit({ session, db, event: on ? "kill_switch.enabled" : "kill_switch.disabled", brandId: acct.brandId, targetType: "connected_account", targetId: accountId, metadata: { scope: "account", on } });
  });
  revalidatePath(`/dashboard/accounts/${accountId}`);
  redirect(`/dashboard/accounts/${accountId}?kind=ok&notice=${encodeURIComponent(on ? "Live actions stopped for this account." : "Live actions resumed for this account.")}`);
}

/**
 * Rollback ("Restore comment") — unhide a previously executed hide. Dry-run unless
 * the env permits a live Graph call. Never touches reply/delete; token never logged.
 */
export async function rollbackExecution(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  const executionId = String(formData.get("executionId") ?? "");
  const backTo = String(formData.get("backTo") ?? "/dashboard/action-queue");

  // Phase 1 — tenant reads (short tx): the executed row + the account's token.
  const { exec, acct } = await withTenant(session.tenantId, async (db) => {
    const exec = await db.platformActionExecution.findFirst({
      where: { id: executionId, tenantId: session.tenantId, status: "executed" },
      select: { id: true, connectedAccountId: true },
    });
    if (!exec) return { exec: null, acct: null };
    const acct = await db.connectedAccount.findFirst({ where: { id: exec.connectedAccountId }, select: { pageId: true, externalId: true, accessToken: true } });
    return { exec, acct };
  });
  if (!exec) redirect(`${backTo}?kind=error&notice=${encodeURIComponent("Nothing to roll back.")}`);

  // Phase 2 — provider HTTP (rollbackHide manages its own short tenant transactions).
  const live = getLiveActionsConfig();
  const res = await rollbackHide({
    tenantId: session.tenantId, executionId: exec.id,
    account: { pageId: acct?.pageId ?? null, externalId: acct?.externalId ?? "", accessToken: acct?.accessToken ?? null },
    live: live.canExecuteLive,
  });
  const notice = res.status === "rolled_back" ? "The comment was restored on Facebook."
    : res.status === "dry_run" ? "Rollback prepared (dry-run). No live change was made."
    : "Rollback failed. The comment may still be hidden.";
  revalidatePath(backTo);
  redirect(`${backTo}?kind=${res.status === "failed" ? "error" : "ok"}&notice=${encodeURIComponent(notice)}`);
}
