"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan, EntitlementError, emitOpsEvent } from "@guardora/core";
import type { MetaDiscoveredPage } from "@guardora/connectors";
import { checkAccountToken, linkMetaAssets } from "@guardora/sync";
import { encryptToken, withTenant, assertTenantActive, enableAccountMonitoringWithinLimit } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { loadOnboardingRaw, clearOnboarding } from "@/server/meta-onboarding";

/**
 * Confirm the Page (and optionally IG) selection. Only here — after explicit
 * user confirmation — is a real connection persisted or refreshed.
 */
export async function confirmMetaSelection(
  onboardingId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  // V1.45C1 — a deleting tenant persists no real provider connection (defence-in-depth).
  await assertTenantActive(session.tenantId);

  // V1.59 2b — FLAT MULTI-SELECT. The form submits `select` values keyed `${platform}:${externalId}` for
  // each chosen Facebook Page / Instagram account (FB and IG are independent items). A page is connected
  // whenever its FB item OR its IG item is chosen (an IG requires its parent Page); monitoring is then
  // activated PER chosen item, atomically (FB=1, IG=1), never a bundle.
  const selected = formData.getAll("select").map(String).filter(Boolean);
  const fbSel = new Set(selected.filter((s) => s.startsWith("facebook:")).map((s) => s.slice("facebook:".length)));
  const igSel = new Set(selected.filter((s) => s.startsWith("instagram:")).map((s) => s.slice("instagram:".length)));

  const row = await loadOnboardingRaw(session, onboardingId);
  if (!row) {
    redirect("/dashboard/accounts/meta/select?flow=expired");
  }
  const brand = await withTenant(session.tenantId, (db) => db.brand.findFirst({ where: { id: row.brandId, tenantId: session.tenantId }, select: { id: true } }));
  if (!brand) {
    redirect("/dashboard/accounts?meta=bad_brand");
  }
  const pages = row.pages as unknown as MetaDiscoveredPage[];
  if (selected.length === 0) {
    redirect("/dashboard/accounts/meta/select?flow=none_selected");
  }

  let connected = 0, monitored = 0, limited = 0;
  const activate = async (id: string) => {
    try { await enableAccountMonitoringWithinLimit(session.tenantId, id); emitOpsEvent("account.monitoring_enabled", { operation: "connect" }); monitored++; }
    catch (e) { if (e instanceof EntitlementError) { emitOpsEvent("subscription.account_limit_reached", { operation: "connect" }); limited++; } else throw e; }
  };

  for (const page of pages) {
    const fbChosen = fbSel.has(page.pageId);
    const igChosen = page.igBusinessId ? igSel.has(page.igBusinessId) : false;
    if (!fbChosen && !igChosen) continue;
    // CONNECT (no bundle limit). The Page is persisted whenever anything on it is chosen (IG needs it).
    const link = await linkMetaAssets({
      tenantId: session.tenantId, brandId: row.brandId, page, connectIg: igChosen,
      scopes: row.grantedScopes, grantedPermissions: row.grantedScopes,
      encryptedToken: encryptToken(page.pageAccessToken), tokenType: row.tokenType, tokenExpiresAt: row.tokenExpiresAt,
    });
    connected += 1 + (igChosen && link.igAccountId ? 1 : 0);
    // ACTIVATE monitoring only for the items the user actually selected (atomic, FB=1, IG=1).
    if (fbChosen) await activate(link.pageAccountId);
    if (igChosen && link.igAccountId) await activate(link.igAccountId);
    // Best-effort token verification on the Page.
    try { await checkAccountToken(session.tenantId, link.pageAccountId); } catch { /* best-effort */ }
  }

  await clearOnboarding(session, onboardingId);
  revalidatePath("/dashboard/accounts");
  redirect(`/dashboard/accounts?connected=${connected}&mon=${monitored}&lim=${limited}`);
}

/** Abandon the onboarding flow without connecting anything. */
export async function cancelMetaSelection(onboardingId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  await loadOnboardingRaw(session, onboardingId); // tenant/user check
  await clearOnboarding(session, onboardingId);
  redirect("/dashboard/accounts");
}
