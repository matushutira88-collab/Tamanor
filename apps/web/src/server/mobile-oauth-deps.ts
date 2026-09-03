import "server-only";
import {
  readUserSession, withTenantDb, withTenant,
  createConnectorOAuthFlow, readConnectorOAuthFlow, finalizeConnectorOAuthFlow,
  generateOAuthState, hashOAuthState,
  getTenantEntitlements,
} from "@guardora/db";
import { ActorKind } from "@prisma/client";
import { classifyWorkspaceRouting, emitOpsEvent, can, Permission, maxPerBrandForPlatform } from "@guardora/core";
import { getMetaConfig, getGoogleBusinessConfig } from "@guardora/config";
import { buildMetaAuthUrl } from "@guardora/connectors";
import { buildGoogleAuthUrl } from "@guardora/sync";
import { importGoogleBusinessLocation } from "@guardora/db";
import {
  loadGoogleBusinessSelection, resolveSelectedLocations,
} from "./google-business-selection";
import { actorFromMobileSession } from "./oauth/actor";
import { applyMetaSelection, startFirstSyncs, sanitizeDiscoveredPages } from "./oauth/meta-selection-service";
import type {
  OAuthDeps, OAuthProviderKey, OAuthResultCode, ProviderAvailabilityDto, SelectableOptionDto,
} from "./mobile-oauth";

/**
 * M7 — the ONE wiring of native connector OAuth to real server data.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CANONICAL REUSE. Nothing about connecting a provider is re-implemented here:
 *
 *   authorization URL  → `buildMetaAuthUrl` / `buildGoogleAuthUrl` (same builders
 *                         the web start routes use)
 *   OAuth state        → `generateOAuthState` / `hashOAuthState`
 *   flow record        → `createConnectorOAuthFlow` (tenant-scoped)
 *   Meta selection     → `applyMetaSelection`, the SAME service the dashboard
 *                         Server Action now calls
 *   Google discovery   → `loadGoogleBusinessSelection` / `resolveSelectedLocations`
 *   Google import      → `importGoogleBusinessLocation`, with the canonical
 *                         `maxPerBrandForPlatform` cap
 *
 * PROVIDER SECRETS never leave this process: the authorization URL carries only a
 * client id, redirect URI, scopes and state — the exchange (which needs the app
 * secret) happens in the existing callback, server-side.
 *
 * TOKEN BOUNDARY: no function here returns a provider access token, refresh token
 * or page token. `sanitizeDiscoveredPages` strips them before options are built.
 * ────────────────────────────────────────────────────────────────────────────
 */

const sessionDeps = {
  readUserSession,
  classifyWorkspace: (kind: unknown) => classifyWorkspaceRouting(kind),
  emitOpsEvent,
};

/** Provider availability, from configuration only. No identifier is exposed. */
function availability(): ProviderAvailabilityDto[] {
  const meta = getMetaConfig();
  const gbp = getGoogleBusinessConfig();
  return [
    {
      provider: "meta",
      configured: Boolean(meta.configured),
      available: Boolean(meta.configured),
      // Meta has no separate approval axis in this product.
      approved: Boolean(meta.configured),
    },
    {
      provider: "google_business",
      configured: gbp.configured,
      // Google needs BOTH the kill switch and Google's own API approval.
      available: gbp.configured && gbp.apiEnabled && gbp.apiApproved,
      approved: gbp.apiApproved,
    },
  ];
}

/** Meta options, from the canonical onboarding row the callback created. */
async function metaOptions(input: {
  tenantId: string; userId: string; onboardingId: string;
}): Promise<SelectableOptionDto[] | null> {
  const row = await withTenantDb(input.tenantId, (db) =>
    db.metaOnboardingSession.findFirst({
      where: {
        id: input.onboardingId, tenantId: input.tenantId, userId: input.userId,
        expiresAt: { gt: new Date() },
      },
      select: { pages: true, brandId: true },
    }),
  );
  if (!row) return null;

  // Tokens are stripped HERE, before anything can be projected onto the wire.
  const pages = sanitizeDiscoveredPages(row.pages as never);

  const connected = await withTenantDb(input.tenantId, (db) =>
    db.connectedAccount.findMany({
      where: { tenantId: input.tenantId, status: { not: "disconnected" } },
      select: { externalId: true },
    }),
  );
  const already = new Set(connected.map((c) => c.externalId));

  const options: SelectableOptionDto[] = [];
  for (const p of pages) {
    options.push({
      // The canonical selection vocabulary the shared service validates against.
      id: `facebook:${p.pageId}`,
      displayName: p.name,
      kind: "facebook_page",
      alreadyConnected: already.has(p.pageId),
      eligible: true,
      reason: null,
    });
    if (p.igBusinessId) {
      options.push({
        id: `instagram:${p.igBusinessId}`,
        displayName: p.igUsername ? `@${p.igUsername}` : p.name,
        kind: "instagram_business",
        alreadyConnected: already.has(p.igBusinessId),
        eligible: true,
        reason: null,
      });
    }
  }
  return options;
}

/** Google options, from fresh canonical discovery. */
async function googleOptions(tenantId: string): Promise<SelectableOptionDto[] | null> {
  const view = await loadGoogleBusinessSelection({ tenantId });
  if (view.state !== "ready") return null;
  const options: SelectableOptionDto[] = [];
  for (const account of view.accounts) {
    for (const loc of account.locations) {
      options.push({
        // The stable provider identity — the ONLY value the client may submit back,
        // and it is re-resolved against fresh discovery before anything is imported.
        id: loc.locationId,
        displayName: loc.displayName,
        kind: "google_business",
        alreadyConnected: loc.alreadyConnected,
        eligible: loc.eligible,
        // Only verified locations may be connected; the reason is a bounded key.
        reason: loc.eligible ? null : "unverified",
      });
    }
  }
  return options;
}

export function realOAuthDeps(): OAuthDeps {
  return {
    ...sessionDeps,

    canManageConnectors: (role) => can(role as Parameters<typeof can>[0], Permission.ConnectorManage),

    providerAvailability: availability,

    listBrands: ({ tenantId }) =>
      withTenantDb(tenantId, (db) =>
        db.brand.findMany({
          where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true },
        }),
      ),

    // Tenant-scoped: a foreign brand reads back as null under RLS.
    findBrand: ({ tenantId, brandId }) =>
      withTenantDb(tenantId, (db) =>
        db.brand.findFirst({ where: { id: brandId, tenantId }, select: { id: true } }),
      ),

    findAccount: ({ tenantId, accountId }) =>
      withTenantDb(tenantId, (db) =>
        db.connectedAccount.findFirst({
          where: { id: accountId, tenantId },
          select: { id: true, brandId: true, platform: true },
        }),
      ).then((a) => (a ? { id: a.id, brandId: a.brandId, platform: a.platform as unknown as string } : null)),

    generateState: generateOAuthState,
    hashState: hashOAuthState,

    createFlow: (input) =>
      createConnectorOAuthFlow({
        userId: input.userId,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        surface: "mobile",
        provider: input.provider,
        intent: input.intent,
        brandId: input.brandId,
        accountId: input.accountId,
        stateHash: input.stateHash,
        expiresAt: input.expiresAt,
      }),

    /**
     * Build the provider authorization URL with the SAME builders the web start
     * routes use. The raw OAuth state travels here — that is what state is for —
     * and no Tamanor credential does.
     */
    buildAuthorizationUrl: ({ provider, state }) => {
      if (provider === "meta") {
        const meta = getMetaConfig();
        if (!meta.configured || !meta.appId || !meta.redirectUri) return { ok: false, reason: "not_configured" };
        return {
          ok: true,
          url: buildMetaAuthUrl({ appId: meta.appId, redirectUri: meta.redirectUri }, { state, scopes: meta.scopes }),
        };
      }
      const gbp = getGoogleBusinessConfig();
      if (!gbp.configured || !gbp.clientId || !gbp.redirectUri) return { ok: false, reason: "not_configured" };
      if (!gbp.apiEnabled || !gbp.apiApproved) return { ok: false, reason: "unavailable" };
      return {
        ok: true,
        url: buildGoogleAuthUrl({ clientId: gbp.clientId, redirectUri: gbp.redirectUri, state }),
      };
    },

    readFlow: ({ tenantId, userId, flowId }) => readConnectorOAuthFlow({ tenantId, userId, flowId }),

    finalizeFlow: ({ tenantId, flowId, status, resultCode, resultAccountId }) =>
      finalizeConnectorOAuthFlow({ tenantId, flowId, status, resultCode, resultAccountId }),

    loadOptions: async ({ flow }) => {
      if (flow.provider === "meta") {
        if (!flow.resultRefId) return null;
        return metaOptions({
          tenantId: flow.tenantId, userId: flow.userId, onboardingId: flow.resultRefId,
        });
      }
      return googleOptions(flow.tenantId);
    },

    applySelection: async ({ flow, actorRole, selected }) => {
      const actor = actorFromMobileSession({
        sessionId: flow.sessionId, userId: flow.userId, tenantId: flow.tenantId, role: actorRole,
      });

      if (flow.provider === "meta") {
        if (!flow.resultRefId) {
          return { ok: false, code: "expired", connected: 0, monitored: 0, limited: 0, slotTaken: 0, rejected: 0, accountIds: [] };
        }
        const row = await withTenantDb(flow.tenantId, (db) =>
          db.metaOnboardingSession.findFirst({
            where: {
              id: flow.resultRefId!, tenantId: flow.tenantId, userId: flow.userId,
              expiresAt: { gt: new Date() },
            },
          }),
        );
        if (!row) {
          return { ok: false, code: "expired", connected: 0, monitored: 0, limited: 0, slotTaken: 0, rejected: 0, accountIds: [] };
        }

        // The SAME service the dashboard Server Action calls.
        const result = await applyMetaSelection({ actor, onboarding: row, selected });
        if (!result.ok) {
          const code: OAuthResultCode =
            result.code === "bad_brand" ? "not_found"
              : result.code === "no_selection" ? "no_accounts"
                : result.code === "save_failed" ? "save_failed"
                  : "expired";
          return { ok: false, code, connected: 0, monitored: 0, limited: 0, slotTaken: 0, rejected: 0, accountIds: [] };
        }

        // First sync, detached exactly as the web schedules it after the response.
        void startFirstSyncs(flow.tenantId, result.syncAccountIds).catch(() => {});
        // The onboarding row has served its purpose; it holds provider tokens, so it goes.
        await withTenantDb(flow.tenantId, (db) =>
          db.metaOnboardingSession.deleteMany({ where: { id: flow.resultRefId! } }),
        ).catch(() => {});

        return {
          ok: true,
          connected: result.connected, monitored: result.monitored,
          limited: result.limited, slotTaken: result.slotTaken, rejected: result.rejected,
          accountIds: result.accountIds,
        };
      }

      /* ---------------------------------------------------- Google Business */
      // Every submitted id is re-resolved against a FRESH server-side discovery, so
      // a forged, foreign or stale id simply is not in the server's list.
      const resolved = await resolveSelectedLocations({ tenantId: flow.tenantId }, [...selected]);
      if (!resolved.ok) {
        return { ok: false, code: "provider_unavailable", connected: 0, monitored: 0, limited: 0, slotTaken: 0, rejected: 0, accountIds: [] };
      }

      const brandId = flow.brandId;
      if (!brandId) {
        return { ok: false, code: "not_found", connected: 0, monitored: 0, limited: 0, slotTaken: 0, rejected: 0, accountIds: [] };
      }

      const ent = await getTenantEntitlements(flow.tenantId);
      const maxPerBrand = maxPerBrandForPlatform(ent, "google_business");

      let connected = 0, slotTaken = 0;
      const accountIds: string[] = [];
      for (const loc of resolved.locations) {
        const outcome = await importGoogleBusinessLocation({
          tenantId: flow.tenantId,
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
          // One location hitting the per-brand cap must not abort the others.
          if (outcome.reason === "brand_platform_limit_reached") {
            emitOpsEvent("subscription.account_limit_reached", { operation: "connect_brand_slot" });
            slotTaken++;
          }
          continue;
        }
        connected++;
        accountIds.push(outcome.accountId);
      }

      return {
        ok: true,
        connected, monitored: 0, limited: 0, slotTaken,
        rejected: resolved.rejectedUnknown + resolved.rejectedIneligible,
        accountIds,
      };
    },

    writeAudit: async ({ tenantId, userId, event, targetId, metadata }) => {
      await withTenant(tenantId, (db) =>
        db.auditLog.create({
          data: {
            tenantId, actorKind: ActorKind.human, actorUserId: userId,
            event, targetType: "connector", targetId,
            // Bounded metadata only — never a state, hash, code or token.
            metadata: metadata as never,
          },
        }),
      );
    },
  };
}
