"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import {
  Permission, assertCan, EntitlementError, emitOpsEvent,
  resolveMetaAssetSelection, classifyMetaPageOnboarding, summarizeMetaPageOnboarding, encodeMetaOnboardingSummary,
  type MetaPageOnboardingOutcome,
} from "@guardora/core";
import { getMetaConfig } from "@guardora/config";
import type { MetaDiscoveredPage } from "@guardora/connectors";
import { checkAccountToken, linkMetaAssets, runReadOnlySync, MetaCredentialPersistError, ensureLeadgenSubscriptionOnConnect } from "@guardora/sync";
import { withTenant, assertTenantActive, enableAccountMonitoringWithinLimit, enforceMonitoringLimits } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { loadOnboardingRaw, clearOnboarding } from "@/server/meta-onboarding";

/** The Graph permission that makes Lead Ads applicable to a Page. */
const LEADS_RETRIEVAL = "leads_retrieval";

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
  // V1.45C1 — a deleting tenant persists no real provider connection (defence-in-depth).
  await assertTenantActive(session.tenantId);

  // V1.59 2b — FLAT MULTI-SELECT. The form submits `select` values keyed `${platform}:${externalId}` for
  // each chosen Facebook Page / Instagram account (FB and IG are independent items). A page is connected
  // whenever its FB item OR its IG item is chosen (an IG requires its parent Page); monitoring is then
  // activated PER chosen item, atomically (FB=1, IG=1), never a bundle.
  const selected = formData.getAll("select").map(String).filter(Boolean);

  const row = await loadOnboardingRaw(session, onboardingId);
  if (!row) {
    redirect("/dashboard/accounts/meta/select?flow=expired");
  }
  const brand = await withTenant(session.tenantId, (db) => db.brand.findFirst({ where: { id: row.brandId, tenantId: session.tenantId }, select: { id: true } }));
  if (!brand) {
    redirect("/dashboard/accounts?meta=bad_brand");
  }
  const pages = row.pages as unknown as MetaDiscoveredPage[];
  if (selected.length === 0) {
    redirect("/dashboard/accounts/meta/select?flow=none_selected");
  }

  // BUSINESS-LEADGEN-ONBOARDING-V1 — every submitted value is validated against the SERVER asset list
  // discovered during THIS authenticated OAuth flow (tenant + user scoped, loaded above). A client can only
  // ever narrow that list: an unowned/foreign/malformed id matches nothing, is counted, and is never acted on
  // — no vault read, no provider call, no account write. Tenant and tokens come from the session/vault only.
  const selection = resolveMetaAssetSelection(pages, selected);
  const fbSel = selection.pages;
  const igSel = selection.instagram;
  if (selection.rejected > 0) {
    // Count only — never the submitted value.
    emitOpsEvent("business.meta_asset_selection_rejected", { operation: "connect_confirm", reason: "unknown_asset" });
  }

  // Whether this deployment asks for lead access at all. When it does not, a Page is a comment-monitoring
  // connection and Lead Ads simply does not apply to it.
  const leadsScopeRequested = getMetaConfig().scopes.includes(LEADS_RETRIEVAL);
  const providerApproved = (process.env.META_LEADS_APPROVED ?? "").trim().toLowerCase() === "true";
  const pageOutcomes: MetaPageOnboardingOutcome[] = [];

  let connected = 0, monitored = 0, limited = 0, slotTaken = 0, credFailed = 0;
  const monitoredIds: string[] = [];
  const activate = async (id: string) => {
    try { await enableAccountMonitoringWithinLimit(session.tenantId, id); emitOpsEvent("account.monitoring_enabled", { operation: "connect" }); monitored++; monitoredIds.push(id); }
    catch (e) { if (e instanceof EntitlementError) { emitOpsEvent("subscription.account_limit_reached", { operation: "connect" }); limited++; } else throw e; }
  };

  for (const page of pages) {
    const fbChosen = fbSel.has(page.pageId);
    const igChosen = page.igBusinessId ? igSel.has(page.igBusinessId) : false;
    if (!fbChosen && !igChosen) continue;
    // CONNECT. The Page is persisted whenever anything on it is chosen (IG needs it). V1.64 — a brand
    // holds at most one active FB + one active IG; if the slot is already taken by a DIFFERENT account,
    // linkMetaAssets throws brand_platform_limit_reached. Skip that page (don't 500) and surface a
    // friendly notice; other selected pages still connect.
    let link;
    try {
      link = await linkMetaAssets({
        tenantId: session.tenantId, brandId: row.brandId, page, connectIg: igChosen,
        scopes: row.grantedScopes, grantedPermissions: row.grantedScopes,
        // VAULT-ONLY: the plaintext page token is sealed into the encrypted ProviderCredential vault by
        // linkMetaAssets and NEVER written to a legacy ConnectedAccount token column.
        pageAccessToken: page.pageAccessToken,
        tokenType: row.tokenType, tokenExpiresAt: row.tokenExpiresAt,
      });
    } catch (e) {
      if (e instanceof EntitlementError && e.reason === "brand_platform_limit_reached") {
        emitOpsEvent("subscription.account_limit_reached", { operation: "connect_brand_slot" });
        slotTaken++;
        continue;
      }
      // Fail-closed vault persistence: the credential could not be sealed/verified. No plaintext was written and a
      // new account was left needing reconnect. Skip this page (don't 500) and surface a generic notice.
      if (e instanceof MetaCredentialPersistError) {
        emitOpsEvent("connector.vault_write_failed", { operation: "connect_confirm" });
        credFailed++;
        continue;
      }
      throw e;
    }
    connected += 1 + (igChosen && link.igAccountId ? 1 : 0);
    // ACTIVATE monitoring only for the items the user actually selected (atomic, FB=1, IG=1).
    if (fbChosen) await activate(link.pageAccountId);
    if (igChosen && link.igAccountId) await activate(link.igAccountId);
    // Best-effort token verification on the Page.
    try { await checkAccountToken(session.tenantId, link.pageAccountId); } catch { /* best-effort */ }

    // BUSINESS-LEADGEN-SUBSCRIPTION-V1 / ONBOARDING-V1 — with the vault credential stored AND verified above
    // (linkMetaAssets fails closed otherwise), subscribe THIS PAGE — never the Instagram account — to this
    // Meta app for the `leadgen` webhook field and verify it by re-reading /{pageId}/subscribed_apps.
    //
    // The customer configures nothing: no Meta Developers visit, no callback URL, no verify token, no Graph
    // call, no Page id, no app id. Provider HTTP runs OUTSIDE every DB transaction (the connect transaction
    // has already committed), only when `leads_retrieval` is present, and is strictly best-effort — a failure
    // leaves this Page, its vault credential, every OTHER selected Page, Instagram, comment sync and
    // monitoring exactly as they are. Each Page is processed independently inside this loop.
    let subscriptionStatus: "verified" | "not_subscribed" | "unavailable" | null = null;
    if (leadsScopeRequested) {
      const leadSub = await ensureLeadgenSubscriptionOnConnect(session.tenantId, link.pageAccountId, row.grantedScopes);
      subscriptionStatus = (leadSub.status as typeof subscriptionStatus) ?? null;
    }
    const outcome = classifyMetaPageOnboarding({
      leadsScopeRequested,
      leadsPermissionGranted: row.grantedScopes.includes(LEADS_RETRIEVAL),
      subscriptionStatus,
      providerApproved,
    });
    pageOutcomes.push(outcome);
    // Bounded outcome label only — no Page/account/tenant id, token or Graph message.
    emitOpsEvent("business.meta_page_onboarded", { operation: "connect_confirm", result: outcome });
  }

  // V1.68 (Release A / A2) — reconnect must NEVER bypass the limit. linkMetaAssets re-activates a
  // previously-monitored account (status→active) while `monitoringEnabled` is preserved, and the
  // enable no-ops when it is already true — so a disconnect→downgrade→reconnect could otherwise re-
  // exceed the cap. Reconcile keep-oldest so the monitored count can never exceed the current plan cap.
  let disabledSet = new Set<string>();
  try {
    const r = await enforceMonitoringLimits(session.tenantId);
    if (r.disabledCount > 0) emitOpsEvent("subscription.monitoring_limit_enforced", { operation: "reconnect" });
    disabledSet = new Set(r.disabledAccountIds);
  } catch { emitOpsEvent("worker.maintenance_failed", { operation: "reconnect_enforce_limits" }); }

  // V1.69 (Release B / B1) — FIRST SYNC ON CONNECT. Kick off the first read-only sync for every account
  // that stayed monitored, AFTER the response (next/server `after`) so the user never waits on the Meta
  // HTTP cycle and doesn't depend on the next cron tick. The sync lease dedups, so a repeated confirmation
  // can't launch duplicate parallel syncs; a sync error is swallowed here and never affects the
  // already-committed connection (results simply surface as a "failed" first-sync state with a retry).
  const toSync = monitoredIds.filter((id) => !disabledSet.has(id));
  if (toSync.length > 0) {
    const tid = session.tenantId;
    after(async () => { await Promise.allSettled(toSync.map((id) => runReadOnlySync({ accountId: id, tenantId: tid }, "automatic"))); });
  }

  await clearOnboarding(session, onboardingId);
  revalidatePath("/dashboard/accounts");
  // Page-specific onboarding summary — COUNTS per bounded outcome only. No Page name, provider id, account id,
  // tenant id or token ever enters the URL; the per-Page detail (with names + the repair action) lives on
  // /dashboard/platforms, which this notice links to.
  const leadSummary = encodeMetaOnboardingSummary(summarizeMetaPageOnboarding(pageOutcomes));
  redirect(`/dashboard/accounts?connected=${connected}&mon=${monitored}&lim=${limited}${slotTaken ? `&slot=${slotTaken}` : ""}${credFailed ? `&credfail=${credFailed}` : ""}${pageOutcomes.length ? `&lead=${leadSummary}` : ""}`);
}

/** Abandon the onboarding flow without connecting anything. */
export async function cancelMetaSelection(onboardingId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  await loadOnboardingRaw(session, onboardingId); // tenant/user check
  await clearOnboarding(session, onboardingId);
  redirect("/dashboard/accounts");
}
