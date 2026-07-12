"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ConnectorMode,
  ConnectorStatus,
  Permission,
  Platform,
  assertCan,
} from "@guardora/core";
import { runReadOnlySync } from "@guardora/sync";
import { disconnectConnectedAccount, withTenant } from "@guardora/db";
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
  const platform = asPlatform(platformRaw);

  await withTenant(session.tenantId, async (db) => {
    // Ensure the brand belongs to the tenant.
    const brand = await db.brand.findFirst({
      where: { id: brandId, tenantId: session.tenantId },
      select: { id: true, name: true },
    });
    if (!brand) throw new Error("Brand not found");

    const existing = await db.connectedAccount.findFirst({ where: { brandId, platform } });

    if (existing) {
      await db.connectedAccount.update({
        where: { id: existing.id },
        data: { status: ConnectorStatus.MockConnected, mode: ConnectorMode.Placeholder },
      });
    } else {
      await db.connectedAccount.create({
        data: {
          tenantId: session.tenantId,
          brandId,
          platform,
          status: ConnectorStatus.MockConnected,
          mode: ConnectorMode.Placeholder,
          externalId: `mock_${platform}_${brandId.slice(-6)}`,
          externalName: `${brand.name} (mock)`,
          scopes: [],
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

  revalidatePath("/dashboard/accounts");
}

export async function disconnect(accountId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);

  // V1.37.3 — tenant runtime (RLS): the account load + update run under the
  // session's tenant context; a foreign/absent id returns null → not_found.
  const account = await disconnectConnectedAccount(session.tenantId, accountId);
  if (!account) throw new Error("Account not found");

  await writeAudit({
    session,
    event: "connector.disconnected",
    brandId: account.brandId,
    targetType: "connected_account",
    targetId: account.id,
    metadata: { platform: account.platform },
  });

  revalidatePath("/dashboard/accounts");
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
    select: { id: true },
  }));
  if (!account) throw new Error("Account not found");

  const outcome = await runReadOnlySync({ accountId, tenantId: session.tenantId });

  revalidatePath(`/dashboard/accounts/${accountId}`);
  revalidatePath("/dashboard/inbox");
  const params = new URLSearchParams({
    kind: outcome.ok ? "ok" : "error",
    notice: `${outcome.message} Fetched ${outcome.fetched}, new ${outcome.created}, deduped ${outcome.deduped}, errors ${outcome.errors} (${outcome.durationMs} ms).`,
  });
  redirect(`/dashboard/accounts/${accountId}?${params.toString()}`);
}
