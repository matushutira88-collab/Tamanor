"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import { updateAccountProtection, canAccountUseAutomatic, clampAutoHideMinConfidence, withTenant, type AutoHideMode } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";

/**
 * V1.60 (2c) — save a single account's comment-protection mode + min-confidence. Fail-closed:
 *  - ConnectorManage permission + same-origin (CSRF) required;
 *  - the account is loaded tenant-scoped (RLS), so a foreign accountId simply resolves to nothing;
 *  - AUTOMATIC is rejected for a demo/mock or read-only account (canAccountUseAutomatic);
 *  - min-confidence is clamped to the server floor (0.8) — a client value can never weaken the gate.
 * The autonomous gate still independently enforces every rule; this action only persists a safe config.
 */
const UI_TO_DB: Record<string, AutoHideMode> = { suggest_only: "recommend", require_approval: "manual_approval", automatic: "automatic" };

export async function updateProtectionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);

  const accountId = String(formData.get("accountId") ?? "");
  const back = accountId ? `/dashboard/accounts/${accountId}` : "/dashboard/accounts";
  if (!(await isSameOrigin())) redirect(`${back}?notice=Security check failed&kind=error`);

  const uiMode = String(formData.get("mode") ?? "");
  const dbMode = UI_TO_DB[uiMode];
  const minConfidence = clampAutoHideMinConfidence(Number(formData.get("minConfidence") ?? "0.8"));
  if (!accountId || !dbMode) redirect(`${back}?notice=Invalid request&kind=error`);

  // Tenant-scoped load — a foreign/gone account is invisible (RLS + explicit scope) → nothing to change.
  const account = await withTenant(session.tenantId, (db) => db.connectedAccount.findFirst({
    where: { id: accountId }, select: { id: true, status: true, mode: true, grantedPermissions: true },
  }));
  if (!account) redirect(`/dashboard/accounts?notice=Account not found&kind=error`);

  if (dbMode === "automatic" && !canAccountUseAutomatic(account)) {
    redirect(`${back}?notice=Automatic protection is not available for a test or read-only account&kind=error`);
  }

  // autoHideEnabled tracks the master switch: only AUTOMATIC arms autonomous execution.
  await updateAccountProtection(session.tenantId, accountId, {
    autoHideMode: dbMode,
    autoHideEnabled: dbMode === "automatic",
    autoHideMinConfidence: minConfidence,
  });

  revalidatePath(back);
  redirect(`${back}?notice=Comment protection saved&kind=ok`);
}
