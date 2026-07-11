"use server";

import { redirect } from "next/navigation";
import { Permission, can } from "@guardora/core";
import { GOOGLE_BUSINESS_AUDIT } from "@guardora/sync";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";

/**
 * V1.36 — disconnect a Google Business Profile connection. Invalidates stored
 * connector credentials (tokens cleared) and marks the account disconnected. No
 * secret or token is ever surfaced. Tenant-scoped.
 */
export async function disconnectGoogleBusiness(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, Permission.ConnectorManage)) redirect("/dashboard/accounts?google=denied");

  const accountId = String(formData.get("accountId") ?? "");
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, tenantId: session.tenantId, platform: "google_business" },
    select: { id: true, brandId: true },
  });
  if (!account) redirect("/dashboard/accounts?google=not_found");

  await prisma.connectedAccount.update({
    where: { id: account!.id },
    data: {
      accessToken: null,
      longLivedToken: null,
      refreshToken: null,
      status: "disconnected",
      health: "unknown",
      lastError: null,
      lastErrorAt: null,
    },
  });

  await writeAudit({
    session,
    event: GOOGLE_BUSINESS_AUDIT.disconnected,
    brandId: account!.brandId,
    targetType: "connector",
    targetId: `account:${account!.id}`,
    metadata: { platform: "google_business" }, // no tokens/secrets
  });

  redirect("/dashboard/accounts?google=disconnected");
}
