"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import type { MetaDiscoveredPage } from "@guardora/connectors";
import { checkAccountToken, linkMetaAssets } from "@guardora/sync";
import { encryptToken, withTenant } from "@guardora/db";
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

  const pageId = String(formData.get("pageId") ?? "");
  const connectIg = formData.get("connectIg") === "on";

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

  // V1.38 — persist the Page (+ optionally its linked IG account) as ONE unified,
  // idempotent connector. A reconnect refreshes the SAME rows (never a duplicate) and
  // (re)establishes the canonical IG → Page parentAccountId link. Fully audited inside.
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

  // V1.27C — verify the stored PAGE token against Graph (GET /{pageId}) right away,
  // so the account only shows fully healthy when the token actually works.
  let verify = "ok";
  try {
    const res = await checkAccountToken(session.tenantId, fbId);
    verify = res.result;
  } catch { /* verification is best-effort; account is still connected */ }

  revalidatePath("/dashboard/accounts");
  redirect(`/dashboard/accounts/${fbId}?connected=1&verify=${encodeURIComponent(verify)}`);
}

/** Abandon the onboarding flow without connecting anything. */
export async function cancelMetaSelection(onboardingId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  await loadOnboardingRaw(session, onboardingId); // tenant/user check
  await clearOnboarding(session, onboardingId);
  redirect("/dashboard/accounts");
}
