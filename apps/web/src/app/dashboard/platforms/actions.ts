"use server";

/**
 * BUSINESS Connected Platforms V1 — server actions. Requires the Business entitlement AND the platforms-manage
 * permission. In this checkpoint NO live connect/reconnect flow exists (no credentials / provider approval /
 * secure credential store), so only a genuine soft-disconnect is exposed. Tenant + actor come ONLY from the
 * session. Audit metadata is provider enum + result only — never a token/secret.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, Permission, BusinessProvider, ALL_BUSINESS_PROVIDERS } from "@guardora/core";
import { disconnectBusinessConnection } from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { writeAudit } from "@/server/audit";

const PLATFORMS = "/dashboard/platforms";

async function manageGate() {
  const cap = await requireDashboardCapability("businessConnectedPlatforms");
  if (!cap.allowed) throw new Error("feature_locked");
  if (!can(cap.session.role, Permission.BusinessPlatformsManage)) throw new Error("permission_denied");
  return cap.session;
}

function isProvider(v: string): v is BusinessProvider {
  return (ALL_BUSINESS_PROVIDERS as string[]).includes(v);
}

/** Soft-disconnect a provider connection (sets status=disconnected; never a hard delete, never a token wipe). */
export async function disconnectPlatformAction(fd: FormData): Promise<void> {
  const session = await manageGate();
  const provider = String(fd.get("provider") ?? "").trim();
  if (!isProvider(provider)) redirect(`${PLATFORMS}?e=input`);
  const ok = await disconnectBusinessConnection(session.tenantId, provider);
  if (ok) {
    await writeAudit({ session, event: "business_connection.disconnected", targetType: "business_connection", metadata: { provider } });
  }
  revalidatePath(PLATFORMS);
  redirect(`${PLATFORMS}?${ok ? "saved=disconnect" : "e=noop"}`);
}
