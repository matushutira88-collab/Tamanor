"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import {
  ConnectorMode,
  ConnectorStatus,
  Permission,
  Platform,
  assertCan,
  EntitlementError,
  isWithinLimit,
  emitOpsEvent,
  maxPerBrandForPlatform,
  resolveConnectionState,
  manualSyncBlocked,
} from "@guardora/core";
import { runReadOnlySync, disconnectAccount } from "@guardora/sync";
import { withTenant, assertTenantActive, getTenantEntitlements, acquireTenantResourceLock, countCommercialConnections, assertBrandPlatformCapacity } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

function asPlatform(raw: string): Platform {
  if (!(Object.values(Platform) as string[]).includes(raw)) {
    throw new Error(`Unknown platform: ${raw}`);
  }
  return raw as Platform;
}

/**
 * Create/refresh a MOCK connection. This performs NO OAuth and NO API call — it
 * only marks a placeholder account as `mock_connected` so the product can be
 * exercised end-to-end. Real OAuth will replace this action.
 */
export async function connectMock(
  brandId: string,
  platformRaw: string,
): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  // V1.45C1 — a deleting tenant accepts no new/refreshed provider connection (defence-in-depth; the
  // session guard already fails closed the instant the tenant is deleting).
  await assertTenantActive(session.tenantId);
  const platform = asPlatform(platformRaw);

  // V1.50F — ATOMIC connection limit: the advisory-locked count + create run in ONE transaction, so
  // concurrent connects can never exceed maxConnectedAccounts. Only a NEW account consumes a slot;
  // reconnecting an existing one does not. A restricted tenant (limit 0) is denied on the server.
  const ent = await getTenantEntitlements(session.tenantId);
  try {
    await withTenant(session.tenantId, async (db) => {
      await acquireTenantResourceLock(db, session.tenantId, "connections");
      const brand = await db.brand.findFirst({ where: { id: brandId, tenantId: session.tenantId }, select: { id: true, name: true } });
      if (!brand) throw new Error("Brand not found");

      const existing = await db.connectedAccount.findFirst({ where: { brandId, platform } });
      if (existing) {
        await db.connectedAccount.update({ where: { id: existing.id }, data: { status: ConnectorStatus.MockConnected, mode: ConnectorMode.Placeholder } });
      } else {
        const count = await countCommercialConnections(db, session.tenantId);
        if (!isWithinLimit(count, ent.maxConnectedAccounts)) throw new EntitlementError("account_limit_reached");
        // V1.64 — a brand holds at most one active account of each platform. The tenant "connections"
        // advisory lock above already serializes concurrent connects, so a plain count-check is race-safe.
        const mockExternalId = `mock_${platform}_${brandId.slice(-6)}`;
        await assertBrandPlatformCapacity(db, brandId, platform, mockExternalId, maxPerBrandForPlatform(ent, platform));
        await db.connectedAccount.create({
          data: {
            tenantId: session.tenantId, brandId, platform,
            status: ConnectorStatus.MockConnected, mode: ConnectorMode.Placeholder,
            externalId: mockExternalId, externalName: `${brand.name} (mock)`, scopes: [],
          },
        });
      }

      await writeAudit({
        session, db,
        event: "connector.mock_connected",
        brandId,
        targetType: "connected_account",
        targetId: `${brandId}:${platform}`,
        metadata: { platform, mock: true },
      });
    });
  } catch (e) {
    if (e instanceof EntitlementError) {
      emitOpsEvent("entitlement.limit_reached", { operation: "connect_account", reason: e.reason });
      redirect(`/dashboard/accounts?error=${e.reason}`);
    }
    throw e;
  }

  revalidatePath("/dashboard/accounts");
}

export async function disconnect(accountId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);

  // V1.37.4 / V1.45B — safe disconnect: tenant read + cluster resolve → best-effort provider
  // revoke (HTTP outside any tx) → ATOMIC local removal of the whole token-sharing cluster
  // (always). A foreign/absent id → not_found.
  const { account, revoke, status, cluster, manualCleanupRecommended } =
    await disconnectAccount(session.tenantId, accountId);
  if (!account) throw new Error("Account not found");

  await writeAudit({
    session,
    event: "connector.disconnected",
    brandId: account.brandId,
    targetType: "connected_account",
    targetId: account.id,
    // Truthful, token-free metadata: the whole local cluster was invalidated; the provider-side
    // revocation classification (Meta per-account = unsupported); whether manual cleanup is
    // recommended. Cluster COUNT (not an unbounded id list) + platforms.
    metadata: {
      platform: account.platform,
      localCredentialsRemoved: true,
      providerRevoke: revoke,
      status,
      clusterCount: cluster.count,
      clusterPlatforms: cluster.platforms,
      manualCleanupRecommended,
      resultingStatus: "disconnected",
    },
  });

  revalidatePath("/dashboard/accounts");
  // Surface a truthful post-disconnect notice (local removal vs. unsupported provider-side
  // revocation + manual-removal guidance). No token or provider detail is ever put in the URL.
  redirect(`/dashboard/accounts?disconnected=${encodeURIComponent(account.platform)}&cluster=${cluster.count}`);
}

/**
 * Run a read-only sync for an account. Creates ReputationItems (mock fallback in
 * placeholder mode). Never performs any moderation action.
 */
export async function runSyncAction(accountId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);

  const account = await withTenant(session.tenantId, (db) => db.connectedAccount.findFirst({
    where: { id: accountId, tenantId: session.tenantId },
    select: {
      id: true, status: true, mode: true, health: true, connectionStatus: true, tokenHealth: true,
      tokenExpiresAt: true, lastError: true, lastSuccessfulSyncAt: true, lastSyncedAt: true, monitoringEnabled: true,
    },
  }));
  if (!account) throw new Error("Account not found");

  // V1.75 (P0) — a manual "Sync now" is BLOCKED when the account needs reconnect (or is
  // disconnected). Starting a sync on an expired/revoked token only fails and re-marks the
  // account — the truthful action is "reconnect first". Uses the ONE canonical resolver.
  const state = resolveConnectionState({ ...account, status: account.status as unknown as string, mode: account.mode as unknown as string, health: account.health as unknown as string });
  if (manualSyncBlocked(state)) {
    revalidatePath(`/dashboard/accounts/${accountId}`);
    redirect(`/dashboard/accounts/${accountId}?kind=error&notice=${encodeURIComponent("Reconnect the account first — manual sync is unavailable until it is reconnected.")}`);
  }

  // V1.69 (Release B / B6) — NON-BLOCKING "Sync now": the read-only sync (which does the whole Meta HTTP
  // cycle) is scheduled to run AFTER the response via next/server `after()`, so the UI request returns
  // immediately instead of holding the connection open for the full provider round-trip. The sync lease
  // dedups concurrent triggers; the account's first-sync state / last-sync time reflect the result on the
  // next page load. Behavior/entitlement logic is unchanged — only the request no longer blocks.
  const tenantId = session.tenantId;
  after(async () => { await runReadOnlySync({ accountId, tenantId }, "manual").catch(() => {}); });

  revalidatePath(`/dashboard/accounts/${accountId}`);
  revalidatePath("/dashboard/inbox");
  redirect(`/dashboard/accounts/${accountId}?kind=ok&notice=${encodeURIComponent("Sync started — results will appear shortly.")}`);
}

/**
 * V1.69 (Release B / B1) — NON-BLOCKING first-sync retry from the accounts list. The read-only sync is
 * scheduled to run AFTER the response (next/server `after`), so the UI request never waits on the Meta
 * HTTP cycle. The sync lease dedups, so double-clicking cannot launch parallel syncs; an error never
 * touches the connection. The row's first-sync state updates on the next page load.
 */
export async function retryFirstSync(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  const accountId = String(formData.get("accountId") ?? "");
  const account = await withTenant(session.tenantId, (db) => db.connectedAccount.findFirst({
    where: { id: accountId, tenantId: session.tenantId },
    select: {
      id: true, status: true, mode: true, health: true, connectionStatus: true, tokenHealth: true,
      tokenExpiresAt: true, lastError: true, lastSuccessfulSyncAt: true, lastSyncedAt: true, monitoringEnabled: true,
    },
  }));
  if (!account) throw new Error("Account not found");
  // V1.75 (P0) — same block as "Sync now": never launch a manual sync on a reconnect-required account.
  const state = resolveConnectionState({ ...account, status: account.status as unknown as string, mode: account.mode as unknown as string, health: account.health as unknown as string });
  if (manualSyncBlocked(state)) {
    revalidatePath("/dashboard/accounts");
    redirect("/dashboard/accounts?sync=reconnect_required");
  }
  const tenantId = session.tenantId;
  after(async () => { await runReadOnlySync({ accountId, tenantId }, "manual").catch(() => {}); });
  revalidatePath("/dashboard/accounts");
  redirect("/dashboard/accounts?sync=started");
}
