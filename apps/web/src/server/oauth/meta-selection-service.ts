import "server-only";
import {
  EntitlementError, emitOpsEvent,
  resolveMetaAssetSelection, classifyMetaPageOnboarding,
  type MetaPageOnboardingOutcome,
} from "@guardora/core";
import { getMetaConfig } from "@guardora/config";
import type { MetaDiscoveredPage } from "@guardora/connectors";
import {
  checkAccountToken, linkMetaAssets, runReadOnlySync, MetaCredentialPersistError,
  ensureLeadgenSubscriptionOnConnect,
} from "@guardora/sync";
import {
  withTenantDb, assertTenantActive, enableAccountMonitoringWithinLimit, enforceMonitoringLimits,
} from "@guardora/db";
import type { OAuthActor } from "./actor";

/**
 * M7 — the Meta page-selection business rules, extracted from the dashboard Server
 * Action so BOTH transports run the identical code.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT MOVED AND WHAT DID NOT.
 *
 * This module is the exact body of `confirmMetaSelection` with the Next transport
 * peeled off: no `redirect`, no `revalidatePath`, no `after`, no cookies, no
 * `FormData`. Every business rule is preserved verbatim and in order —
 * `assertTenantActive`, server-side asset re-validation, `linkMetaAssets` (vault
 * write), atomic per-item monitoring enable, brand/platform slot handling, the
 * Lead Ads subscription, `enforceMonitoringLimits`, and the first-sync kick-off.
 *
 * The web action keeps its redirects and calls this; the mobile route returns JSON
 * and calls this. Neither owns a private copy of a rule, so the two surfaces
 * cannot drift — which is the whole point of the extraction.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The Graph permission that makes Lead Ads applicable to a Page. */
const LEADS_RETRIEVAL = "leads_retrieval";

/** A page as offered for selection — WITHOUT any token material. */
export interface SelectableMetaAsset {
  pageId: string;
  name: string;
  category?: string;
  hasInstagram: boolean;
  igBusinessId?: string;
  igUsername?: string;
}

/** Strip every token field before discovery leaves the server boundary. */
export function sanitizeDiscoveredPages(pages: readonly MetaDiscoveredPage[]): SelectableMetaAsset[] {
  return pages.map((p) => ({
    pageId: p.pageId,
    name: p.name,
    category: p.category,
    hasInstagram: Boolean(p.igBusinessId),
    igBusinessId: p.igBusinessId,
    igUsername: p.igUsername,
  }));
}

/** Bounded outcome of a selection. Counts and codes only — never provider text. */
export interface MetaSelectionResult {
  ok: boolean;
  /** Bounded failure code when `ok` is false. */
  code?: "expired" | "bad_brand" | "no_selection" | "save_failed";
  connected: number;
  monitored: number;
  /** Selections refused by the plan's monitored-account limit. */
  limited: number;
  /** Selections refused because the brand's platform slot was already taken. */
  slotTaken: number;
  /** Selections refused because the credential vault write failed closed. */
  credFailed: number;
  /** Submitted ids that matched no server-discovered asset. A COUNT only. */
  rejected: number;
  /** The ConnectedAccount ids that were created or refreshed. */
  accountIds: string[];
  /** Accounts that stayed monitored and should get a first sync. */
  syncAccountIds: string[];
  outcomes: MetaPageOnboardingOutcome[];
}

/**
 * The raw onboarding row this service needs. Loaded by the caller so the web path
 * can keep using its cookie-scoped loader and the mobile path can load by flow.
 */
export interface MetaOnboardingRow {
  id: string;
  brandId: string;
  grantedScopes: string[];
  tokenType: string | null;
  tokenExpiresAt: Date | null;
  authorizingProviderUserId: string | null;
  pages: unknown;
}

/**
 * Apply a Meta page/IG selection.
 *
 * `selected` uses the canonical `${platform}:${externalId}` vocabulary and is
 * validated against the SERVER's discovered asset list — a client can only ever
 * narrow that list, never extend it. An unowned, foreign or malformed id matches
 * nothing, is counted in `rejected`, and never reaches a vault read, a provider
 * call or an account write.
 *
 * Returns a bounded result; it never throws for an expected condition and never
 * performs an HTTP redirect.
 */
export async function applyMetaSelection(input: {
  actor: OAuthActor;
  onboarding: MetaOnboardingRow;
  selected: readonly string[];
}): Promise<MetaSelectionResult> {
  const { actor, onboarding, selected } = input;

  const empty = (code: MetaSelectionResult["code"]): MetaSelectionResult => ({
    ok: false, code, connected: 0, monitored: 0, limited: 0, slotTaken: 0,
    credFailed: 0, rejected: 0, accountIds: [], syncAccountIds: [], outcomes: [],
  });

  // A deleting tenant persists no real provider connection (defence-in-depth).
  await assertTenantActive(actor.tenantId);

  const brand = await withTenantDb(actor.tenantId, (db) =>
    db.brand.findFirst({ where: { id: onboarding.brandId, tenantId: actor.tenantId }, select: { id: true } }),
  );
  if (!brand) return empty("bad_brand");

  const pages = onboarding.pages as unknown as MetaDiscoveredPage[];
  if (!Array.isArray(pages) || pages.length === 0) return empty("expired");
  if (selected.length === 0) return empty("no_selection");

  const selection = resolveMetaAssetSelection(pages, selected);
  const fbSel = selection.pages;
  const igSel = selection.instagram;
  if (selection.rejected > 0) {
    // Count only — never the submitted value, which is attacker-controlled text.
    emitOpsEvent("business.meta_asset_selection_rejected", { operation: "connect_confirm", reason: "unknown_asset" });
  }

  const leadsScopeRequested = getMetaConfig().scopes.includes(LEADS_RETRIEVAL);
  const providerApproved = (process.env.META_LEADS_APPROVED ?? "").trim().toLowerCase() === "true";
  const outcomes: MetaPageOnboardingOutcome[] = [];

  let connected = 0, monitored = 0, limited = 0, slotTaken = 0, credFailed = 0;
  const accountIds: string[] = [];
  const monitoredIds: string[] = [];

  const activate = async (id: string) => {
    try {
      await enableAccountMonitoringWithinLimit(actor.tenantId, id);
      emitOpsEvent("account.monitoring_enabled", { operation: "connect" });
      monitored++;
      monitoredIds.push(id);
    } catch (e) {
      if (e instanceof EntitlementError) {
        emitOpsEvent("subscription.account_limit_reached", { operation: "connect" });
        limited++;
      } else throw e;
    }
  };

  for (const page of pages) {
    const fbChosen = fbSel.has(page.pageId);
    const igChosen = page.igBusinessId ? igSel.has(page.igBusinessId) : false;
    if (!fbChosen && !igChosen) continue;

    let link;
    try {
      link = await linkMetaAssets({
        tenantId: actor.tenantId, brandId: onboarding.brandId, page, connectIg: igChosen,
        scopes: onboarding.grantedScopes, grantedPermissions: onboarding.grantedScopes,
        // VAULT-ONLY: sealed into the encrypted ProviderCredential vault by
        // linkMetaAssets and NEVER written to a legacy token column.
        pageAccessToken: page.pageAccessToken,
        tokenType: onboarding.tokenType, tokenExpiresAt: onboarding.tokenExpiresAt,
        // Server-resolved during the OAuth callback — never a client submission.
        authorizingProviderUserId: onboarding.authorizingProviderUserId,
      });
    } catch (e) {
      if (e instanceof EntitlementError && e.reason === "brand_platform_limit_reached") {
        emitOpsEvent("subscription.account_limit_reached", { operation: "connect_brand_slot" });
        slotTaken++;
        continue;
      }
      if (e instanceof MetaCredentialPersistError) {
        emitOpsEvent("connector.vault_write_failed", { operation: "connect_confirm" });
        credFailed++;
        continue;
      }
      throw e;
    }

    connected += 1 + (igChosen && link.igAccountId ? 1 : 0);
    accountIds.push(link.pageAccountId);
    if (igChosen && link.igAccountId) accountIds.push(link.igAccountId);

    if (fbChosen) await activate(link.pageAccountId);
    if (igChosen && link.igAccountId) await activate(link.igAccountId);

    try { await checkAccountToken(actor.tenantId, link.pageAccountId); } catch { /* best-effort */ }

    let subscriptionStatus: "verified" | "not_subscribed" | "unavailable" | null = null;
    if (leadsScopeRequested) {
      const leadSub = await ensureLeadgenSubscriptionOnConnect(actor.tenantId, link.pageAccountId, onboarding.grantedScopes);
      subscriptionStatus = (leadSub.status as typeof subscriptionStatus) ?? null;
    }
    const outcome = classifyMetaPageOnboarding({
      leadsScopeRequested,
      leadsPermissionGranted: onboarding.grantedScopes.includes(LEADS_RETRIEVAL),
      subscriptionStatus,
      providerApproved,
    });
    outcomes.push(outcome);
    emitOpsEvent("business.meta_page_onboarded", { operation: "connect_confirm", result: outcome });
  }

  // Reconnect must NEVER bypass the limit: linkMetaAssets re-activates a previously
  // monitored account while `monitoringEnabled` is preserved, so reconcile keep-oldest.
  let disabledSet = new Set<string>();
  try {
    const r = await enforceMonitoringLimits(actor.tenantId);
    if (r.disabledCount > 0) emitOpsEvent("subscription.monitoring_limit_enforced", { operation: "reconnect" });
    disabledSet = new Set(r.disabledAccountIds);
  } catch {
    emitOpsEvent("worker.maintenance_failed", { operation: "reconnect_enforce_limits" });
  }

  return {
    ok: true,
    connected, monitored, limited, slotTaken, credFailed,
    rejected: selection.rejected,
    accountIds,
    // The caller schedules these; scheduling is a transport concern (`after` on web,
    // a detached promise on mobile), so it is deliberately not done here.
    syncAccountIds: monitoredIds.filter((id) => !disabledSet.has(id)),
    outcomes,
  };
}

/**
 * Kick off the first read-only sync for freshly-monitored accounts.
 *
 * Separated from {@link applyMetaSelection} so each transport can schedule it in
 * the way its runtime supports. The sync lease dedups, so a repeated confirmation
 * cannot launch duplicate parallel syncs, and an error never touches the
 * already-committed connection.
 */
export async function startFirstSyncs(tenantId: string, accountIds: readonly string[]): Promise<void> {
  if (accountIds.length === 0) return;
  await Promise.allSettled(
    accountIds.map((id) => runReadOnlySync({ accountId: id, tenantId }, "automatic")),
  );
}
