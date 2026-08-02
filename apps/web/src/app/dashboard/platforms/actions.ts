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
import { ensureAccountLeadgenSubscription } from "@guardora/sync";
import { requireDashboardCapability } from "@/server/route-guard";
import { writeAudit } from "@/server/audit";
import { isSameOrigin } from "@/server/csrf";
import { leadgenSubscriptionRepairLimiter } from "@/lib/rate-limit";

const PLATFORMS = "/dashboard/platforms";
const ACCOUNTS = "/dashboard/accounts";

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

/**
 * BUSINESS-LEADGEN-SUBSCRIPTION-V1 — repair an EXISTING connected Facebook Page whose Page↔app `leadgen`
 * webhook subscription was never established (the reason Lead Ads produced no contacts). Subscribes the Page
 * to this Meta app via `/{page-id}/subscribed_apps`, preserving every field it is already subscribed to, and
 * verifies the result with a second read before recording success.
 *
 * No disconnect/reconnect is required. Idempotent: an already-subscribed Page performs no provider write.
 * Authorization is the existing connector-management permission on top of the Business platforms feature gate;
 * the account lookup is tenant-scoped (RLS) so a foreign account id simply does not resolve. Rate-limited per
 * account. Surfaces a safe result code only — never a token, proof, provider body, or identifier.
 */
export async function repairMetaLeadgenSubscriptionAction(fd: FormData): Promise<void> {
  const cap = await requireDashboardCapability("businessConnectedPlatforms");
  if (!cap.allowed) throw new Error("feature_locked");
  const session = cap.session;
  // The existing connector-management permission governs provider-side connector changes.
  if (!can(session.role, Permission.ConnectorManage)) redirect(`${PLATFORMS}?e=denied`);
  if (!(await isSameOrigin())) redirect(`${PLATFORMS}?e=csrf`);

  const accountId = String(fd.get("accountId") ?? "").trim();
  if (!accountId) redirect(`${PLATFORMS}?e=input`);

  // Provider-touching action — bounded per account so a repeated click cannot hammer Graph.
  const limit = await leadgenSubscriptionRepairLimiter.check(accountId);
  if (!limit.allowed) redirect(`${PLATFORMS}?e=rate_limited`);

  // Tenant-scoped lookup + Facebook-Page-only / active-only guards + provider HTTP (outside any transaction) +
  // post-write verification, all for THIS account alone. The tenant comes from the session and the Page id and
  // token are resolved server-side — the client supplies nothing but the connected-account id.
  const res = await ensureAccountLeadgenSubscription(session.tenantId, accountId);
  await writeAudit({
    session,
    event: res.verified ? "meta.leadgen.subscription_repaired" : "meta.leadgen.subscription_repair_failed",
    targetType: "connected_account",
    targetId: accountId,
    // Classified fields only — no token, secret, proof, provider body, or Page id.
    metadata: { provider: BusinessProvider.Meta, status: res.status, alreadySubscribed: res.alreadySubscribed, ...(res.reason ? { reason: res.reason } : {}) },
  });

  revalidatePath(ACCOUNTS);
  revalidatePath(PLATFORMS);
  redirect(`${PLATFORMS}?${res.verified ? "saved=lead_webhook" : "e=lead_webhook"}`);
}
