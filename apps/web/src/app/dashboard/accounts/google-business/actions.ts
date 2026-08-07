"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Permission, can, assertCan, emitOpsEvent, maxPerBrandForPlatform,
} from "@guardora/core";
import { GOOGLE_BUSINESS_AUDIT, disconnectAccount } from "@guardora/sync";
import {
  assertTenantActive, getTenantEntitlements,
  importGoogleBusinessLocation, assertGoogleBusinessCapabilities,
} from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { resolveSelectedLocations } from "@/server/google-business-selection";

const SELECT_PATH = "/dashboard/accounts/google-business/select";

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

/**
 * SLICE 2 — import the user's selected Google Business locations as ConnectedAccounts.
 *
 * CSRF. This is a Next.js Server Action, the same mutation primitive `confirmMetaSelection` uses. The
 * framework binds an encrypted, per-deployment action id and rejects cross-origin POSTs by comparing
 * Origin against Host before this function is ever entered, so a forged form on another site cannot
 * invoke it. On top of that the action re-derives the session server-side (`requireSession`) and
 * re-checks `Permission.ConnectorManage` — the browser supplies no identity, tenant or role.
 *
 * TRUST. The ONLY thing accepted from the form is a list of Google location ids. Every one of them is
 * re-resolved against a FRESH server-side discovery before anything is written
 * ({@link resolveSelectedLocations}): an id that is forged, belongs to another tenant's Google account,
 * or has become unverified since the page rendered simply is not in the server's list and is counted as
 * rejected. No display name, address or eligibility flag from the browser is ever persisted.
 *
 * TRUTHFULNESS. Each location is imported independently and the redirect carries COUNTS of what actually
 * happened — imported, reconnected, and each rejection category. A partial failure is reported as a
 * partial failure; nothing claims success it did not achieve.
 */
export async function confirmGoogleBusinessSelection(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  // A deleting tenant persists no new provider connection (defence-in-depth, same as Meta).
  await assertTenantActive(session.tenantId);

  const brandId = String(formData.get("brandId") ?? "").trim();
  const submitted = formData.getAll("location").map(String).filter(Boolean);
  if (submitted.length === 0) redirect(`${SELECT_PATH}?flow=none_selected`);
  if (!brandId) redirect(`${SELECT_PATH}?flow=no_brand`);

  // Server-authoritative re-validation. Also re-applies the API_ENABLED / API_APPROVED gates and the
  // "connection is actually active" check before any write.
  const resolved = await resolveSelectedLocations(session, submitted);
  if (!resolved.ok) redirect(`${SELECT_PATH}?flow=${resolved.reason}`);
  if (resolved.rejectedUnknown > 0) {
    // Count only — never the submitted value, which is attacker-controlled text.
    emitOpsEvent("business.google_location_selection_rejected", { operation: "connect_confirm", reason: "unknown_asset" });
  }

  const ent = await getTenantEntitlements(session.tenantId);
  const maxPerBrand = maxPerBrandForPlatform(ent, "google_business");

  let imported = 0, reconnected = 0, limited = 0, failed = 0;
  const accountIds: string[] = [];
  for (const loc of resolved.locations) {
    const outcome = await importGoogleBusinessLocation({
      tenantId: session.tenantId,
      brandId,
      location: {
        providerLocationId: loc.providerLocationId,
        providerLocationName: loc.providerLocationName,
        displayName: loc.displayName,
        storeCode: loc.storeCode ?? null,
        addressSummary: loc.addressSummary ?? null,
        providerAccountId: loc.providerAccountId,
      },
      scopes: [],
      maxPerBrand,
    });
    if (!outcome.ok) {
      // One location hitting the per-brand cap must not abort the others; it is reported, not thrown.
      if (outcome.reason === "brand_platform_limit_reached") { limited++; emitOpsEvent("subscription.account_limit_reached", { operation: "connect_brand_slot" }); }
      else failed++;
      continue;
    }
    outcome.reconnected ? reconnected++ : imported++;
    accountIds.push(outcome.accountId);
  }

  // CAPABILITY — asserted ONLY after at least one location genuinely landed. `brand_monitoring` and
  // nothing else: this connector reads reviews, it does not moderate or reply.
  let capabilities: string[] = [];
  if (imported + reconnected > 0) {
    capabilities = await assertGoogleBusinessCapabilities(session.tenantId);
    await writeAudit({
      session,
      event: GOOGLE_BUSINESS_AUDIT.locationsSelected,
      brandId,
      targetType: "connector",
      targetId: "google_business",
      // Bounded counts and labels only — no location names, addresses or token material.
      metadata: {
        platform: "google_business", imported, reconnected, limited, failed,
        rejectedUnknown: resolved.rejectedUnknown, rejectedIneligible: resolved.rejectedIneligible,
        capabilities,
      },
    });
  }

  revalidatePath("/dashboard/accounts");
  // Counts only. No provider id, location name, tenant id or token ever enters the URL.
  const q = new URLSearchParams({ gbpImported: String(imported), gbpReconnected: String(reconnected) });
  if (limited) q.set("gbpLimited", String(limited));
  if (failed) q.set("gbpFailed", String(failed));
  if (resolved.rejectedIneligible) q.set("gbpIneligible", String(resolved.rejectedIneligible));
  if (resolved.rejectedUnknown) q.set("gbpUnknown", String(resolved.rejectedUnknown));
  // Nothing at all landed → stay on the selection step rather than implying a connected state.
  if (imported + reconnected === 0) redirect(`${SELECT_PATH}?${q.toString()}`);
  redirect(`/dashboard/accounts?${q.toString()}`);
}
