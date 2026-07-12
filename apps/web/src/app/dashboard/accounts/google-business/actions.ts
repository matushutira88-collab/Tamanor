"use server";

import { redirect } from "next/navigation";
import { Permission, can } from "@guardora/core";
import { GOOGLE_BUSINESS_AUDIT, disconnectAccount } from "@guardora/sync";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

/**
 * V1.36/V1.37.4 — disconnect a Google Business Profile connection through the shared
 * disconnect lifecycle: local credentials are removed; GBP is a read-only connector
 * with no confirmed programmatic revoke, so the provider-revoke is reported truthfully
 * as `unsupported` (no fake "provider access revoked"). Tenant-scoped; no token surfaced.
 */
export async function disconnectGoogleBusiness(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, Permission.ConnectorManage)) redirect("/dashboard/accounts?google=denied");

  const accountId = String(formData.get("accountId") ?? "");
  const { account, revoke, status } = await disconnectAccount(session.tenantId, accountId);
  if (!account || account.platform !== "google_business") redirect("/dashboard/accounts?google=not_found");

  await writeAudit({
    session,
    event: GOOGLE_BUSINESS_AUDIT.disconnected,
    brandId: account.brandId,
    targetType: "connector",
    targetId: `account:${account.id}`,
    // Truthful: local credentials removed; provider revoke unsupported (read-only). No token.
    metadata: { platform: "google_business", localCredentialsRemoved: true, providerRevoke: revoke, status },
  });

  redirect("/dashboard/accounts?google=disconnected");
}
