"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import type { MetaDiscoveredPage } from "@guardora/connectors";
import {
  ConnectorStatus,
  ConnectorMode,
  ConnectorHealth,
  Platform,
  encryptToken,
} from "@guardora/db";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { loadOnboardingRaw, clearOnboarding } from "@/server/meta-onboarding";

/**
 * Confirm the Page (and optionally IG) selection and create the ConnectedAccount
 * records. Only here — after explicit user confirmation — is a real connection
 * persisted. Tokens are stored server-side only and never audited.
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

  // Re-check brand ownership + permission scope.
  const brand = await prisma.brand.findFirst({
    where: { id: row.brandId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!brand) {
    redirect("/dashboard/accounts?meta=bad_brand");
  }

  const pages = row.pages as unknown as MetaDiscoveredPage[];
  const page = pages.find((p) => p.pageId === pageId);
  if (!page) {
    redirect("/dashboard/accounts/meta/select?flow=bad_page");
  }

  // The scopes actually requested/granted for this flow (env-driven).
  const scopes = row.grantedScopes;
  const granted = row.grantedScopes;
  // Page tokens obtained via a long-lived user token are long-lived. Store them
  // through the encryption seam (dev: tagged plaintext; prod: KMS).
  const encryptedToken = encryptToken(page.pageAccessToken);

  // Facebook Page account (always created on confirm).
  const fb = await prisma.connectedAccount.upsert({
    where: {
      brandId_platform_externalId: {
        brandId: row.brandId,
        platform: Platform.facebook_page,
        externalId: page.pageId,
      },
    },
    create: {
      tenantId: session.tenantId,
      brandId: row.brandId,
      platform: Platform.facebook_page,
      status: ConnectorStatus.active,
      mode: ConnectorMode.read_only,
      health: ConnectorHealth.healthy,
      externalId: page.pageId,
      externalName: page.name,
      pageId: page.pageId,
      igBusinessId: page.igBusinessId ?? null,
      scopes,
      grantedPermissions: granted,
      accessToken: encryptedToken,
      longLivedToken: encryptedToken,
      tokenType: row.tokenType,
      tokenExpiresAt: row.tokenExpiresAt,
    },
    update: {
      status: ConnectorStatus.active,
      mode: ConnectorMode.read_only,
      health: ConnectorHealth.healthy,
      externalName: page.name,
      igBusinessId: page.igBusinessId ?? null,
      accessToken: encryptedToken,
      longLivedToken: encryptedToken,
      tokenType: row.tokenType,
      tokenExpiresAt: row.tokenExpiresAt,
      lastError: null,
      lastErrorAt: null,
    },
  });
  await writeAudit({
    session,
    event: "account.connected",
    brandId: row.brandId,
    targetType: "connected_account",
    targetId: fb.id,
    metadata: { platform: "facebook_page", mode: "read_only" },
  });

  // Optionally connect the linked Instagram Business account.
  if (connectIg && page.igBusinessId) {
    const ig = await prisma.connectedAccount.upsert({
      where: {
        brandId_platform_externalId: {
          brandId: row.brandId,
          platform: Platform.instagram_business,
          externalId: page.igBusinessId,
        },
      },
      create: {
        tenantId: session.tenantId,
        brandId: row.brandId,
        platform: Platform.instagram_business,
        status: ConnectorStatus.active,
        mode: ConnectorMode.read_only,
        health: ConnectorHealth.healthy,
        externalId: page.igBusinessId,
        externalName: page.igUsername ? `@${page.igUsername}` : page.name,
        pageId: page.pageId,
        igBusinessId: page.igBusinessId,
        scopes,
        grantedPermissions: granted,
        accessToken: encryptedToken,
      longLivedToken: encryptedToken,
        tokenType: row.tokenType,
        tokenExpiresAt: row.tokenExpiresAt,
      },
      update: {
        status: ConnectorStatus.active,
        mode: ConnectorMode.read_only,
        health: ConnectorHealth.healthy,
        externalName: page.igUsername ? `@${page.igUsername}` : page.name,
        accessToken: encryptedToken,
      longLivedToken: encryptedToken,
        tokenType: row.tokenType,
        tokenExpiresAt: row.tokenExpiresAt,
        lastError: null,
        lastErrorAt: null,
      },
    });
    await writeAudit({
      session,
      event: "account.connected",
      brandId: row.brandId,
      targetType: "connected_account",
      targetId: ig.id,
      metadata: { platform: "instagram_business", mode: "read_only" },
    });
  }

  await clearOnboarding(onboardingId);

  revalidatePath("/dashboard/accounts");
  redirect(`/dashboard/accounts/${fb.id}?connected=1`);
}

/** Abandon the onboarding flow without connecting anything. */
export async function cancelMetaSelection(onboardingId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  await loadOnboardingRaw(session, onboardingId); // tenant/user check
  await clearOnboarding(onboardingId);
  redirect("/dashboard/accounts");
}
