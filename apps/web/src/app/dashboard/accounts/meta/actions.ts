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

  const pageId = String(formData.get("pageId") ?? "");
  // V1.59 — CONNECT and MONITOR are separate, per-account choices. `connectIg` still controls whether the
  // IG account is persisted; `monitorFb`/`monitorIg` (default on) control whether monitoring is ACTIVATED
  // for each — enforced atomically, FB and IG counted separately.
  const connectIg = formData.get("connectIg") === "on";
  const monitorFb = formData.get("monitorFb") !== "off";
  const monitorIg = formData.get("monitorIg") !== "off";

  const row = await loadOnboardingRaw(session, onboardingId);
  if (!row) {
    redirect("/dashboard/accounts/meta/select?flow=expired");
  }

  const brand = await withTenant(session.tenantId, (db) => db.brand.findFirst({
    where: { id: row.brandId, tenantId: session.tenantId },
    select: { id: true },
  }));
  if (!brand) {
    redirect("/dashboard/accounts?meta=bad_brand");
  }

  const pages = row.pages as unknown as MetaDiscoveredPage[];
  const page = pages.find((p) => p.pageId === pageId);
  if (!page) {
    redirect("/dashboard/accounts/meta/select?flow=bad_page");
  }

  // Scopes actually requested/granted for THIS flow (env-driven).
  const scopes = row.grantedScopes;
  const granted = row.grantedScopes;
  // Page tokens (from a long-lived user token) are long-lived. Encrypt at rest.
  const encryptedToken = encryptToken(page.pageAccessToken);

  // V1.59 — CONNECT the Page (+ optionally IG) WITHOUT a bundle limit. Accounts are persisted as
  // connected-but-not-monitored; the plan limit is enforced per-account when monitoring is activated.
  const link = await linkMetaAssets({
    tenantId: session.tenantId,
    brandId: row.brandId,
    page,
    connectIg,
    scopes,
    grantedPermissions: granted,
    encryptedToken,
    tokenType: row.tokenType,
    tokenExpiresAt: row.tokenExpiresAt,
  });
  const fbId = link.pageAccountId;

  await clearOnboarding(session, onboardingId);

  // V1.59 — ACTIVATE monitoring per selected account, ATOMICALLY (FB=1, IG=1). Each enable goes through
  // enableAccountMonitoringWithinLimit (advisory-locked); an account that would exceed the plan limit is
  // left connected-but-unmonitored and reported — never a silent partial result, never a bypass.
  let monitored = 0, limited = 0;
  const activate = async (id: string) => {
    try { await enableAccountMonitoringWithinLimit(session.tenantId, id); emitOpsEvent("account.monitoring_enabled", { operation: "connect" }); monitored++; }
    catch (e) { if (e instanceof EntitlementError) { emitOpsEvent("subscription.account_limit_reached", { operation: "connect" }); limited++; } else throw e; }
  };
  if (monitorFb) await activate(fbId);
  if (connectIg && monitorIg && link.igAccountId) await activate(link.igAccountId);

  // V1.27C — verify the stored PAGE token against Graph right away (best-effort).
  let verify = "ok";
  try { verify = (await checkAccountToken(session.tenantId, fbId)).result; } catch { /* best-effort */ }

  revalidatePath("/dashboard/accounts");
  redirect(`/dashboard/accounts?connected=1&mon=${monitored}&lim=${limited}&verify=${encodeURIComponent(verify)}`);
}

/** Abandon the onboarding flow without connecting anything. */
export async function cancelMetaSelection(onboardingId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  await loadOnboardingRaw(session, onboardingId); // tenant/user check
  await clearOnboarding(session, onboardingId);
  redirect("/dashboard/accounts");
}
