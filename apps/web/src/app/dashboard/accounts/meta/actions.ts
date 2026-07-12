"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import type { MetaDiscoveredPage } from "@guardora/connectors";
import { checkAccountToken } from "@guardora/sync";
import {
  Platform,
  encryptToken,
  metaConnectedAccountFields,
  withTenant,
} from "@guardora/db";
import type { AppSession } from "@/server/auth";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { loadOnboardingRaw, clearOnboarding } from "@/server/meta-onboarding";

/**
 * Create or RECONNECT a Meta ConnectedAccount for a Page/IG selection.
 *
 * On reconnect the existing row (unique on brandId+platform+externalId) is fully
 * refreshed: scopes, grantedPermissions, and all token fields are ALWAYS
 * overwritten with the current OAuth result, health is reset to healthy, and any
 * error/backoff state is cleared. No duplicate is ever created. Tokens are
 * stored encrypted server-side and are never logged or audited.
 */
async function upsertMetaAccount(
  session: AppSession,
  input: {
    brandId: string;
    platform: Platform;
    externalId: string;
    externalName: string;
    pageId: string;
    igBusinessId: string | null;
    scopes: string[];
    granted: string[];
    encryptedToken: string;
    tokenType: string | null;
    tokenExpiresAt: Date | null;
  },
): Promise<string> {
  const { brandId, platform, externalId } = input;

  // Every field below is overwritten on BOTH create and update (shared builder),
  // so a reconnect can never keep stale scopes/permissions/tokens.
  const fields = metaConnectedAccountFields({
    externalName: input.externalName,
    pageId: input.pageId,
    igBusinessId: input.igBusinessId,
    scopes: input.scopes,
    grantedPermissions: input.granted,
    encryptedToken: input.encryptedToken,
    tokenType: input.tokenType,
    tokenExpiresAt: input.tokenExpiresAt,
  });

  return withTenant(session.tenantId, async (db) => {
    // Determine reconnect vs. first connect (for the audit event only).
    const existing = await db.connectedAccount.findFirst({
      where: { brandId, platform, externalId },
      select: { id: true },
    });

    const account = await db.connectedAccount.upsert({
      where: { brandId_platform_externalId: { brandId, platform, externalId } },
      create: { tenantId: session.tenantId, brandId, platform, externalId, ...fields },
      update: fields,
    });

    await writeAudit({
      session, db,
      event: existing ? "account.reconnected" : "account.connected",
      brandId,
      targetType: "connected_account",
      targetId: account.id,
      // NO token material — only non-secret context.
      metadata: {
        platform,
        mode: "read_only",
        reconnected: Boolean(existing),
        scopes: input.scopes.length,
        grantedPermissions: input.granted.length,
      },
    });

    return account.id;
  });
}

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

  // Facebook Page account (always created/refreshed on confirm).
  const fbId = await upsertMetaAccount(session, {
    brandId: row.brandId,
    platform: Platform.facebook_page,
    externalId: page.pageId,
    externalName: page.name,
    pageId: page.pageId,
    igBusinessId: page.igBusinessId ?? null,
    scopes,
    granted,
    encryptedToken,
    tokenType: row.tokenType,
    tokenExpiresAt: row.tokenExpiresAt,
  });

  // Optionally connect/refresh the linked Instagram Business account.
  if (connectIg && page.igBusinessId) {
    await upsertMetaAccount(session, {
      brandId: row.brandId,
      platform: Platform.instagram_business,
      externalId: page.igBusinessId,
      externalName: page.igUsername ? `@${page.igUsername}` : page.name,
      pageId: page.pageId,
      igBusinessId: page.igBusinessId,
      scopes,
      granted,
      encryptedToken,
      tokenType: row.tokenType,
      tokenExpiresAt: row.tokenExpiresAt,
    });
  }

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
