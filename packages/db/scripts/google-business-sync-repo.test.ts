/**
 * GOOGLE BUSINESS SLICE 3A — token resolution + review sync integration (local Postgres).
 *
 * Drives the REAL `runReadOnlySync` against a real database with an injected review executor and an
 * injected token-endpoint fetch, so lease handling, RLS, idempotency, verdicts, health fields, the
 * encrypted vault and the entitlement-checked monitoring activation are all exercised for real — with no
 * network. Proves reviews land in the EXISTING ContentItem/ReputationItem model, not a parallel one.
 *
 * Run via: pnpm google-business-sync-repo:test
 */
import { createHash } from "node:crypto";
const TEST_KEK = createHash("sha256").update("gbp-slice3a-test-kek").digest("base64");
process.env.PROVIDER_VAULT_KEK = TEST_KEK;
// Both Google axes ON for this suite; the fail-closed OFF cases are asserted explicitly below.
process.env.GOOGLE_BUSINESS_CLIENT_ID = "cid-test";
process.env.GOOGLE_BUSINESS_CLIENT_SECRET = "secret-test-DO-NOT-LEAK";
process.env.GOOGLE_BUSINESS_REDIRECT_URI = "https://app.example/cb";
process.env.GOOGLE_BUSINESS_API_ENABLED = "true";
process.env.GOOGLE_BUSINESS_API_APPROVED = "true";

import {
  systemDb, withTenant, persistGoogleBusinessGrant, activateGoogleBusinessConnection,
  importGoogleBusinessLocation, findMetaSyncCandidates,
  BusinessConnectionStatus, BusinessProvider, ProviderCredentialPurpose,
} from "../src/index";
// @guardora/sync is not a dependency of @guardora/db — import via relative path (same as connection-truth.test.ts).
import {
  resolveGoogleBusinessAccessToken, activateGoogleBusinessMonitoring,
  markGoogleBusinessReconnectRequired, clearGoogleBusinessReconnectRequired,
  type GoogleTokenFetch,
} from "../../sync/src/google-business-token";
import { runReadOnlySync } from "../../sync/src/index";
import type { GoogleReviewExecutor } from "../../sync/src/google-business-connector";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const rnd = () => Math.random().toString(36).slice(2, 10);

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const REFRESH = "1//gbp3a-refresh-DO-NOT-LEAK";

/** Token endpoint stub. Counts calls so single-flight and "don't refresh unnecessarily" are provable. */
function tokenEndpoint(res: () => { ok: boolean; status: number; body: unknown }) {
  let calls = 0;
  const impl: GoogleTokenFetch = async () => { calls++; const r = res(); return { ok: r.ok, status: r.status, json: async () => r.body }; };
  return { impl, calls: () => calls };
}
const refreshedBody = (token: string, over: Record<string, unknown> = {}) =>
  ({ access_token: token, expires_in: 3600, token_type: "Bearer", scope: SCOPE, ...over });

async function seedConnectedTenant(tag: string, opts: { accessExpiresAt: Date }) {
  const slug = `gbp3a-${tag}-${rnd()}`;
  // internalAccess → full_access, so the read-only-sync billing gate never pauses these fixtures.
  const t = await systemDb.tenant.create({ data: { name: slug, slug, internalAccess: true } });
  const b = await systemDb.brand.create({ data: { tenantId: t.id, name: `B ${slug}` } });
  const grant = await persistGoogleBusinessGrant({
    tenantId: t.id,
    credentials: { refreshToken: REFRESH, accessToken: `ya29.initial-${tag}`, accessTokenExpiresAt: opts.accessExpiresAt, tokenType: "Bearer", scopes: [SCOPE] },
  });
  if (!grant.ok) throw new Error("grant setup failed");
  await activateGoogleBusinessConnection({ tenantId: t.id, connectionId: grant.connectionId, status: BusinessConnectionStatus.active });
  return { tenantId: t.id, brandId: b.id, connectionId: grant.connectionId };
}

/** Deterministic discovery stub — one account, one location, verified unless told otherwise. */
function discoveryStub(locationId: string, verified = true) {
  return {
    async listAccounts() { return { accounts: [{ name: "accounts/900", accountName: "Northwind", type: "LOCATION_GROUP", role: "OWNER", verificationState: "VERIFIED" }] }; },
    async listLocations() {
      return { locations: [{ name: `accounts/900/locations/${locationId}`, title: "Northwind Praha", storeCode: "PRG-1", storefrontAddress: { addressLines: ["Ulice 1"], locality: "Praha" }, metadata: { hasVoiceOfMerchant: verified } }] };
    },
  };
}

/** Deterministic review executor over explicit pages. */
function reviewExecutor(pages: unknown[][]) {
  let calls = 0;
  const executor: GoogleReviewExecutor = async (input) => {
    calls++;
    const i = input.pageToken?.startsWith("rp-") ? Number(input.pageToken.slice(3)) : 0;
    const last = i >= pages.length - 1;
    return { reviews: (pages[Math.min(i, pages.length - 1)] ?? []) as never, nextPageToken: last ? undefined : `rp-${i + 1}` };
  };
  return { executor, calls: () => calls };
}

const review = (id: string, over: Record<string, unknown> = {}) => ({
  reviewId: id, starRating: "FIVE", comment: `Great place ${id}`,
  reviewer: { displayName: `Person ${id}` }, createTime: "2026-01-02T03:04:05Z", ...over,
});

async function main() {
  console.log("\nGoogle Business Slice 3A — token resolution + review sync\n");
  const tenants: string[] = [];
  const FUTURE = new Date(Date.now() + 60 * 60_000);
  const PAST = new Date(Date.now() - 60_000);
  try {
    // ---- 1) Fast path: a valid token is reused with NO refresh ------------------------------------
    console.log("1) Token resolution — reuse");
    const A = await seedConnectedTenant("a", { accessExpiresAt: FUTURE }); tenants.push(A.tenantId);
    const ep1 = tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody("ya29.should-not-be-used") }));
    const r1 = await resolveGoogleBusinessAccessToken(A.tenantId, { fetchImpl: ep1.impl });
    check("1a) a still-valid access token resolves", r1.ok === true && r1.ok && r1.accessToken === "ya29.initial-a");
    check("1b) NO refresh was performed", r1.ok && r1.refreshed === false && ep1.calls() === 0);
    const again = await resolveGoogleBusinessAccessToken(A.tenantId, { fetchImpl: ep1.impl });
    check("1c) repeated resolution still performs no network call", again.ok && ep1.calls() === 0);

    // ---- 2) Expired token refreshes and persists encrypted ----------------------------------------
    console.log("\n2) Token resolution — refresh");
    const B = await seedConnectedTenant("b", { accessExpiresAt: PAST }); tenants.push(B.tenantId);
    const ep2 = tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody("ya29.refreshed-b") }));
    const r2 = await resolveGoogleBusinessAccessToken(B.tenantId, { fetchImpl: ep2.impl });
    check("2a) an expired access token is refreshed", r2.ok === true && r2.ok && r2.refreshed === true && r2.accessToken === "ya29.refreshed-b");
    check("2b) exactly one refresh call was made", ep2.calls() === 1);
    const accessRow = await systemDb.providerCredential.findFirstOrThrow({
      where: { tenantId: B.tenantId, businessConnectionId: B.connectionId, purpose: ProviderCredentialPurpose.access_token, revokedAt: null },
    });
    check("2c) the NEW access token is stored ENCRYPTED — no plaintext in the row",
      !JSON.stringify(accessRow).includes("ya29.refreshed-b") && !!accessRow.ciphertext && !!accessRow.authTag);
    check("2d) the new expiry is truthful and in the future", (accessRow.expiresAt?.getTime() ?? 0) > Date.now());
    const refreshRow = await systemDb.providerCredential.findFirstOrThrow({
      where: { tenantId: B.tenantId, businessConnectionId: B.connectionId, purpose: ProviderCredentialPurpose.refresh_token, revokedAt: null },
    });
    check("2e) the ORIGINAL refresh token is preserved when Google does not rotate",
      !JSON.stringify(refreshRow).includes(REFRESH) && refreshRow.expiresAt === null);
    check("2f) a subsequent resolution reuses the refreshed token without another call",
      (await resolveGoogleBusinessAccessToken(B.tenantId, { fetchImpl: ep2.impl })).ok && ep2.calls() === 1);
    check("2g) still exactly two active credential rows (no accumulation)",
      (await systemDb.providerCredential.count({ where: { tenantId: B.tenantId, businessConnectionId: B.connectionId, revokedAt: null } })) === 2);

    // ---- 3) Rotation --------------------------------------------------------------------------------
    console.log("\n3) Refresh-token rotation");
    const C = await seedConnectedTenant("c", { accessExpiresAt: PAST }); tenants.push(C.tenantId);
    const ep3 = tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody("ya29.refreshed-c", { refresh_token: "1//ROTATED-c" }) }));
    const r3 = await resolveGoogleBusinessAccessToken(C.tenantId, { fetchImpl: ep3.impl });
    check("3a) a rotated refresh token is accepted", r3.ok === true);
    const rot = await systemDb.providerCredential.findFirstOrThrow({
      where: { tenantId: C.tenantId, businessConnectionId: C.connectionId, purpose: ProviderCredentialPurpose.refresh_token, revokedAt: null },
    });
    check("3b) the rotation replaced the row IN PLACE (one active refresh credential)",
      (await systemDb.providerCredential.count({ where: { tenantId: C.tenantId, purpose: ProviderCredentialPurpose.refresh_token, revokedAt: null } })) === 1 && rot.rotatedAt !== null);
    check("3c) the rotated secret is encrypted, never plaintext", !JSON.stringify(rot).includes("1//ROTATED-c"));

    // ---- 4) Concurrency: single-flight refresh ------------------------------------------------------
    console.log("\n4) Concurrent refresh (single flight)");
    const D = await seedConnectedTenant("d", { accessExpiresAt: PAST }); tenants.push(D.tenantId);
    let n = 0;
    const ep4 = tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody(`ya29.refreshed-d-${++n}`) }));
    const racers = await Promise.all(Array.from({ length: 5 }, () => resolveGoogleBusinessAccessToken(D.tenantId, { fetchImpl: ep4.impl })));
    check("4a) every concurrent caller gets a token", racers.every((r) => r.ok));
    check("4b) exactly ONE refresh network call was made for five callers", ep4.calls() === 1, `calls=${ep4.calls()}`);
    const tokens = new Set(racers.filter((r): r is Extract<typeof r, { ok: true }> => r.ok).map((r) => r.accessToken));
    check("4c) all callers converge on the SAME token (no clobbering)", tokens.size === 1, `distinct=${tokens.size}`);
    check("4d) the credential state is not corrupted — one active row per purpose",
      (await systemDb.providerCredential.count({ where: { tenantId: D.tenantId, businessConnectionId: D.connectionId, revokedAt: null } })) === 2);

    // ---- 5) Failure classification ------------------------------------------------------------------
    console.log("\n5) Refresh failure handling");
    const E = await seedConnectedTenant("e", { accessExpiresAt: PAST }); tenants.push(E.tenantId);
    const epBad = tokenEndpoint(() => ({ ok: false, status: 400, body: { error: "invalid_grant", error_description: "Token revoked by user" } }));
    const rBad = await resolveGoogleBusinessAccessToken(E.tenantId, { fetchImpl: epBad.impl });
    check("5a) invalid_grant fails closed as reconnect_required", rBad.ok === false && !rBad.ok && rBad.failure === "reconnect_required");
    check("5b) it is NOT retryable", !rBad.ok && rBad.retryable === false);
    check("5c) no provider text escapes", !JSON.stringify(rBad).includes("revoked by user"));
    check("5d) the refresh credential was NOT deleted or revoked",
      (await systemDb.providerCredential.count({ where: { tenantId: E.tenantId, purpose: ProviderCredentialPurpose.refresh_token, revokedAt: null } })) === 1);
    await markGoogleBusinessReconnectRequired(E.tenantId, "reconnect_required");
    check("5e) the connection is marked reauth_required using the EXISTING vocabulary",
      (await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { tenantId: E.tenantId } })).status === BusinessConnectionStatus.reauth_required);
    await clearGoogleBusinessReconnectRequired(E.tenantId);
    check("5f) the reauth mark is REVERSIBLE once a token works again",
      (await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { tenantId: E.tenantId } })).status === BusinessConnectionStatus.active);
    {
      const epRate = tokenEndpoint(() => ({ ok: false, status: 429, body: { error: "rate" } }));
      const r = await resolveGoogleBusinessAccessToken(E.tenantId, { fetchImpl: epRate.impl });
      check("5g) a rate limit is retryable, never a reconnect", !r.ok && r.failure === "rate_limited" && r.retryable === true);
    }
    {
      const ep5 = tokenEndpoint(() => ({ ok: false, status: 503, body: {} }));
      const r = await resolveGoogleBusinessAccessToken(E.tenantId, { fetchImpl: ep5.impl });
      check("5h) a 5xx is retryable", !r.ok && r.failure === "transient_failure" && r.retryable === true);
    }

    // ---- 6) Feature axes fail closed ----------------------------------------------------------------
    console.log("\n6) Fail-closed feature axes");
    {
      const off = { ...process.env, GOOGLE_BUSINESS_API_ENABLED: "false" } as NodeJS.ProcessEnv;
      const ep = tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody("nope") }));
      const r = await resolveGoogleBusinessAccessToken(B.tenantId, { fetchImpl: ep.impl, source: off });
      check("6a) API_ENABLED=false fails closed with no credential read or network call", !r.ok && r.failure === "api_disabled" && ep.calls() === 0);
    }
    {
      const off = { ...process.env, GOOGLE_BUSINESS_API_APPROVED: "false" } as NodeJS.ProcessEnv;
      const ep = tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody("nope") }));
      const r = await resolveGoogleBusinessAccessToken(B.tenantId, { fetchImpl: ep.impl, source: off });
      check("6b) API_APPROVED=false fails closed separately", !r.ok && r.failure === "api_access_unconfirmed" && ep.calls() === 0);
    }
    {
      const F = await seedConnectedTenant("f", { accessExpiresAt: FUTURE }); tenants.push(F.tenantId);
      await systemDb.businessPlatformConnection.updateMany({ where: { tenantId: F.tenantId }, data: { status: BusinessConnectionStatus.disconnected } });
      const ep = tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody("nope") }));
      const r = await resolveGoogleBusinessAccessToken(F.tenantId, { fetchImpl: ep.impl });
      check("6c) a disconnected connection yields no token", !r.ok && r.failure === "not_connected" && ep.calls() === 0);
    }

    // ---- 7) Tenant isolation --------------------------------------------------------------------------
    console.log("\n7) Tenant isolation");
    {
      const aTok = await resolveGoogleBusinessAccessToken(A.tenantId, { fetchImpl: tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody("x") })).impl });
      const bTok = await resolveGoogleBusinessAccessToken(B.tenantId, { fetchImpl: tokenEndpoint(() => ({ ok: true, status: 200, body: refreshedBody("x") })).impl });
      check("7a) two tenants resolve their OWN distinct tokens",
        aTok.ok && bTok.ok && aTok.accessToken !== bTok.accessToken && aTok.connectionId !== bTok.connectionId);
    }
    {
      const G = await seedConnectedTenant("g", { accessExpiresAt: FUTURE }); tenants.push(G.tenantId);
      check("7b) a tenant with no credential of another tenant's connection is isolated",
        (await systemDb.providerCredential.count({ where: { tenantId: G.tenantId, businessConnectionId: A.connectionId } })) === 0);
    }

    // ---- 8) Monitoring activation ---------------------------------------------------------------------
    console.log("\n8) Monitoring activation");
    const H = await seedConnectedTenant("h", { accessExpiresAt: FUTURE }); tenants.push(H.tenantId);
    const impH = await importGoogleBusinessLocation({
      tenantId: H.tenantId, brandId: H.brandId,
      location: { providerLocationId: "L1", providerLocationName: "accounts/900/locations/L1", displayName: "Northwind", storeCode: null, addressSummary: null, providerAccountId: "900" },
      scopes: [SCOPE], maxPerBrand: null,
    });
    if (!impH.ok) throw new Error("import setup failed");
    const accH = impH.accountId;
    check("8a) Slice 2 import leaves monitoring OFF",
      (await systemDb.connectedAccount.findFirstOrThrow({ where: { id: accH } })).monitoringEnabled === false);
    const noSync = await activateGoogleBusinessMonitoring(H.tenantId, accH);
    check("8b) activation is REFUSED before any successful sync", noSync.enabled === false && !noSync.enabled && noSync.reason === "sync_not_proven");
    check("8c) monitoring is still off in the database",
      (await systemDb.connectedAccount.findFirstOrThrow({ where: { id: accH } })).monitoringEnabled === false);
    check("8d) an unmonitored account is NEVER picked up by background discovery",
      (await findMetaSyncCandidates(["active"])).every((a) => a.id !== accH));

    // Simulate a genuinely successful sync (the only thing activation trusts).
    await systemDb.connectedAccount.updateMany({ where: { id: accH }, data: { lastSuccessfulSyncAt: new Date(), health: "healthy" } });
    const activated = await activateGoogleBusinessMonitoring(H.tenantId, accH);
    check("8e) after a real successful sync, monitoring may be enabled", activated.enabled === true);
    check("8f) it is persisted", (await systemDb.connectedAccount.findFirstOrThrow({ where: { id: accH } })).monitoringEnabled === true);
    check("8g) a monitored account IS now picked up by background discovery",
      (await findMetaSyncCandidates(["active"])).some((a) => a.id === accH));
    const twice = await activateGoogleBusinessMonitoring(H.tenantId, accH);
    check("8h) activation is idempotent", twice.enabled === true && twice.enabled && twice.alreadyEnabled === true);
    {
      const conn = await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { tenantId: H.tenantId } });
      await systemDb.businessPlatformConnection.updateMany({ where: { id: conn.id }, data: { status: BusinessConnectionStatus.reauth_required } });
      const I = await seedConnectedTenant("i", { accessExpiresAt: FUTURE }); tenants.push(I.tenantId);
      const impI = await importGoogleBusinessLocation({
        tenantId: I.tenantId, brandId: I.brandId,
        location: { providerLocationId: "L9", providerLocationName: "accounts/900/locations/L9", displayName: "N9", storeCode: null, addressSummary: null, providerAccountId: "900" },
        scopes: [SCOPE], maxPerBrand: null,
      });
      if (impI.ok) {
        await systemDb.connectedAccount.updateMany({ where: { id: impI.accountId }, data: { lastSuccessfulSyncAt: new Date() } });
        await systemDb.businessPlatformConnection.updateMany({ where: { tenantId: I.tenantId }, data: { status: BusinessConnectionStatus.reauth_required } });
        const r = await activateGoogleBusinessMonitoring(I.tenantId, impI.accountId);
        check("8i) a reconnect-required connection is NOT monitored", r.enabled === false);
      }
      await systemDb.businessPlatformConnection.updateMany({ where: { id: conn.id }, data: { status: BusinessConnectionStatus.active } });
    }

    // ---- 9) Plan limit ----------------------------------------------------------------------------------
    console.log("\n9) Plan limit");
    {
      // `free_trial` caps maxConnectedAccounts at ONE for the whole tenant, so the second location
      // cannot be monitored no matter how healthy it is.
      const J = await seedConnectedTenant("j", { accessExpiresAt: FUTURE }); tenants.push(J.tenantId);
      // An ACTIVE trial (so nothing is billing-restricted) whose plan caps the tenant at ONE monitored
      // account. `internalAccess` must go off, or the tenant would resolve to unlimited entitlements.
      await systemDb.tenant.updateMany({ where: { id: J.tenantId }, data: {
        plan: "free_trial", internalAccess: false, accessState: "full_access",
        billingStatus: "trialing", trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
      } });
      const mk = async (id: string, brandId: string) => {
        const r = await importGoogleBusinessLocation({
          tenantId: J.tenantId, brandId,
          location: { providerLocationId: id, providerLocationName: `accounts/900/locations/${id}`, displayName: id, storeCode: null, addressSummary: null, providerAccountId: "900" },
          scopes: [SCOPE], maxPerBrand: null,
        });
        if (!r.ok) throw new Error(`import ${id} failed`);
        await systemDb.connectedAccount.updateMany({ where: { id: r.accountId }, data: { lastSuccessfulSyncAt: new Date() } });
        return r.accountId;
      };
      const b2 = await systemDb.brand.create({ data: { tenantId: J.tenantId, name: `B2 ${rnd()}` } });
      const first = await mk("P1", J.brandId);
      const second = await mk("P2", b2.id);
      const a1 = await activateGoogleBusinessMonitoring(J.tenantId, first);
      const a2 = await activateGoogleBusinessMonitoring(J.tenantId, second);
      check("9a) the first location fits the plan's monitored-account cap", a1.enabled === true);
      check("9b) the SECOND is refused with a truthful plan-limit reason", a2.enabled === false && !a2.enabled && a2.reason === "plan_limit_reached");
      check("9c) the refused account stays CONNECTED, just unmonitored", (await systemDb.connectedAccount.findFirstOrThrow({ where: { id: second } })).status === "active");
      check("9d) …and its monitoring flag is genuinely off", (await systemDb.connectedAccount.findFirstOrThrow({ where: { id: second } })).monitoringEnabled === false);
      check("9e) the entitlement cap was not bypassed",
        (await systemDb.connectedAccount.count({ where: { tenantId: J.tenantId, monitoringEnabled: true } })) === 1);
    }

    // ---- 10) Malformed / hostile input --------------------------------------------------------------------
    console.log("\n10) Malformed input");
    check("10a) activation refuses an unknown account id", (await activateGoogleBusinessMonitoring(A.tenantId, "acc_does_not_exist")).enabled === false);
    {
      const K = await seedConnectedTenant("k", { accessExpiresAt: FUTURE }); tenants.push(K.tenantId);
      const fb = await systemDb.connectedAccount.create({ data: {
        tenantId: K.tenantId, brandId: K.brandId, platform: "facebook_page", status: "active", mode: "read_only",
        externalId: `FB_${rnd()}`, lastSuccessfulSyncAt: new Date(), monitoringEnabled: false,
      } as never });
      const r = await activateGoogleBusinessMonitoring(K.tenantId, fb.id);
      check("10b) activation refuses a NON-google account", r.enabled === false && !r.enabled && r.reason === "not_google");
      check("10c) …and leaves it untouched", (await systemDb.connectedAccount.findFirstOrThrow({ where: { id: fb.id } })).monitoringEnabled === false);
      check("10d) an account of ANOTHER tenant is not activatable", (await activateGoogleBusinessMonitoring(A.tenantId, fb.id)).enabled === false);
    }
    {
      const ep = tokenEndpoint(() => ({ ok: true, status: 200, body: { token_type: "Bearer" } }));
      const L = await seedConnectedTenant("l", { accessExpiresAt: PAST }); tenants.push(L.tenantId);
      const r = await resolveGoogleBusinessAccessToken(L.tenantId, { fetchImpl: ep.impl });
      check("10e) a malformed token response is rejected, and nothing is stored",
        !r.ok && r.failure === "malformed_response");
      const row = await systemDb.providerCredential.findFirstOrThrow({
        where: { tenantId: L.tenantId, purpose: ProviderCredentialPurpose.access_token, revokedAt: null },
      });
      check("10f) the previous (expired) access credential was not corrupted", (row.expiresAt?.getTime() ?? 0) === PAST.getTime());
    }

    // ---- 11) No secret leakage anywhere ---------------------------------------------------------------------
    console.log("\n11) Secret containment");
    {
      const rows = await systemDb.providerCredential.findMany({ where: { tenantId: { in: tenants } } });
      const dump = JSON.stringify(rows);
      check("11a) NO refresh/access token plaintext exists in any credential row",
        !dump.includes(REFRESH) && !dump.includes("ya29.") && !dump.includes("1//ROTATED"));
      const audits = await systemDb.auditLog.findMany({ where: { tenantId: { in: tenants } } });
      const adump = JSON.stringify(audits);
      check("11b) NO token material appears in any audit record",
        !adump.includes(REFRESH) && !adump.includes("ya29.") && !adump.includes("secret-test"));
      const conns = await systemDb.businessPlatformConnection.findMany({ where: { tenantId: { in: tenants } } });
      check("11c) NO token material appears on the connection rows",
        !JSON.stringify(conns).includes("ya29.") && !JSON.stringify(conns).includes(REFRESH));
      const accounts = await systemDb.connectedAccount.findMany({ where: { tenantId: { in: tenants }, platform: "google_business" as never } });
      check("11d) the legacy plaintext token columns stay NULL on every Google account",
        accounts.every((a) => a.accessToken === null && a.refreshToken === null && a.longLivedToken === null));
    }
    // ---- 12) END-TO-END SYNC through the REAL orchestrator ------------------------------------------
    console.log("\n12) End-to-end review sync");
    const M = await seedConnectedTenant("m", { accessExpiresAt: FUTURE }); tenants.push(M.tenantId);
    const impM = await importGoogleBusinessLocation({
      tenantId: M.tenantId, brandId: M.brandId,
      location: { providerLocationId: "LSYNC", providerLocationName: "accounts/900/locations/LSYNC", displayName: "Northwind Praha", storeCode: "PRG-1", addressSummary: "Ulice 1, Praha", providerAccountId: "900" },
      scopes: [SCOPE], maxPerBrand: null,
    });
    if (!impM.ok) throw new Error("sync fixture import failed");
    const accM = impM.accountId;
    const gsync = (pages: unknown[][], over: Record<string, unknown> = {}) => {
      const ex = reviewExecutor(pages);
      return { ex, hooks: { googleDiscoveryClient: discoveryStub("LSYNC"), googleReviewExecutor: ex.executor, disableHeartbeat: true, ...over } };
    };
    {
      const g = gsync([[review("g1"), review("g2")], [review("g3")]]);
      const out = await runReadOnlySync({ accountId: accM, tenantId: M.tenantId }, "manual", g.hooks);
      check("12a) the first Google sync succeeds through the SHARED orchestrator", out.ok === true && out.verdict === "success");
      check("12b) every page was fetched", out.fetched === 3 && out.created === 3, `fetched=${out.fetched} created=${out.created}`);
      const items = await withTenant(M.tenantId, (db) => db.contentItem.findMany({ where: { connectedAccountId: accM }, orderBy: { externalId: "asc" } }));
      check("12c) reviews land in the EXISTING ContentItem model", items.length === 3);
      check("12d) they carry the google_business platform and `review` kind",
        items.every((i) => i.platform === "google_business" && i.kind === "review"));
      check("12e) the stable provider review id is the externalId", items.map((i) => i.externalId).join(",") === "g1,g2,g3");
      check("12f) rating, text and published time are persisted",
        items[0].rating === 5 && items[0].text === "Great place g1" && items[0].publishedAt.toISOString() === "2026-01-02T03:04:05.000Z");
      check("12g) the author is the location-scoped synthetic id, never a Google account id",
        (items[0].authorExternalId ?? "").startsWith("loc:LSYNC:") && items[0].authorDisplayName === "Person g1");
      check("12h) the review is attached to the right ConnectedAccount and tenant",
        items.every((i) => i.connectedAccountId === accM && i.tenantId === M.tenantId));
      check("12i) NO raw Google payload is stored", !JSON.stringify(items).includes("starRating") && !JSON.stringify(items).includes("reviewReply"));
      const reps = await withTenant(M.tenantId, (db) => db.reputationItem.findMany({ where: { tenantId: M.tenantId } }));
      check("12j) the EXISTING reputation projection ran — no parallel review model", reps.length === 3);
      const acc = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: accM } });
      check("12k) success updates the existing truth fields", acc.lastSuccessfulSyncAt !== null && acc.health === "healthy" && acc.lastError === null);
      const runs = await withTenant(M.tenantId, (db) => db.syncRun.findMany({ where: { connectedAccountId: accM } }));
      check("12l) a SyncRun records the completed run", runs.length === 1 && runs[0].status === "completed");
    }
    {
      // Idempotency: the same reviews again must not duplicate.
      const g = gsync([[review("g1"), review("g2")], [review("g3")]]);
      const out = await runReadOnlySync({ accountId: accM, tenantId: M.tenantId }, "manual", g.hooks);
      check("12m) a repeat sync is idempotent — nothing created", out.ok === true && out.created === 0 && out.deduped === 3);
      check("12n) still exactly three content items",
        (await withTenant(M.tenantId, (db) => db.contentItem.count({ where: { connectedAccountId: accM } }))) === 3);
    }
    {
      // A provider-side EDIT updates the same record rather than creating a second one.
      const g = gsync([[review("g1", { comment: "Edited by the reviewer" })]]);
      const out = await runReadOnlySync({ accountId: accM, tenantId: M.tenantId }, "manual", g.hooks);
      check("12o) an edited review UPDATES the same record", out.updated === 1 && out.created === 0);
      const edited = await withTenant(M.tenantId, (db) => db.contentItem.findFirstOrThrow({ where: { connectedAccountId: accM, externalId: "g1" } }));
      check("12p) the mutable provider field changed in place", edited.text === "Edited by the reviewer");
      check("12q) no duplicate row appeared",
        (await withTenant(M.tenantId, (db) => db.contentItem.count({ where: { connectedAccountId: accM } }))) === 3);
    }
    {
      // Two tenants holding the SAME provider review id stay isolated.
      const N = await seedConnectedTenant("n", { accessExpiresAt: FUTURE }); tenants.push(N.tenantId);
      const impN = await importGoogleBusinessLocation({
        tenantId: N.tenantId, brandId: N.brandId,
        location: { providerLocationId: "LSYNC", providerLocationName: "accounts/900/locations/LSYNC", displayName: "Other tenant", storeCode: null, addressSummary: null, providerAccountId: "900" },
        scopes: [SCOPE], maxPerBrand: null,
      });
      if (impN.ok) {
        const g = gsync([[review("g1")]]);
        await runReadOnlySync({ accountId: impN.accountId, tenantId: N.tenantId }, "manual", g.hooks);
        const mine = await withTenant(N.tenantId, (db) => db.contentItem.findMany({ where: { externalId: "g1" } }));
        check("12r) the same provider review id in another tenant is a SEPARATE record", mine.length === 1 && mine[0].tenantId === N.tenantId);
        check("12s) it did not touch the first tenant's copy",
          (await withTenant(M.tenantId, (db) => db.contentItem.findFirstOrThrow({ where: { connectedAccountId: accM, externalId: "g1" } }))).text === "Edited by the reviewer");
      }
    }
    {
      // A TRUNCATED fetch must not be recorded as a complete success.
      let calls = 0;
      const endless: GoogleReviewExecutor = async () => { calls++; return { reviews: [review(`t${calls}`)] as never, nextPageToken: `x-${calls}` }; };
      const out = await runReadOnlySync({ accountId: accM, tenantId: M.tenantId }, "manual", {
        googleDiscoveryClient: discoveryStub("LSYNC"), googleReviewExecutor: endless, disableHeartbeat: true,
      });
      const audits = await withTenant(M.tenantId, (db) => db.auditLog.findMany({
        where: { targetId: accM, event: { startsWith: "sync." } }, orderBy: { createdAt: "desc" }, take: 1,
      }));
      check("12t) a truncated walk still ingests what it read", out.ok === true && out.fetched > 0);
      check("12u) …and the run records truncated:true rather than claiming completeness",
        JSON.stringify(audits[0]?.metadata ?? {}).includes('"truncated":true'));
    }
    {
      // A dead grant must NOT fake a successful sync.
      const P = await seedConnectedTenant("p", { accessExpiresAt: PAST }); tenants.push(P.tenantId);
      const impP = await importGoogleBusinessLocation({
        tenantId: P.tenantId, brandId: P.brandId,
        location: { providerLocationId: "LDEAD", providerLocationName: "accounts/900/locations/LDEAD", displayName: "Dead", storeCode: null, addressSummary: null, providerAccountId: "900" },
        scopes: [SCOPE], maxPerBrand: null,
      });
      if (impP.ok) {
        // No fetchImpl is reachable from runReadOnlySync, so the real refresh runs against a token
        // endpoint that does not exist in this process — it fails transiently, which is enough to prove
        // that a failed token resolution never produces a success.
        const out = await runReadOnlySync({ accountId: impP.accountId, tenantId: P.tenantId }, "manual", {
          googleDiscoveryClient: discoveryStub("LDEAD"), googleReviewExecutor: reviewExecutor([[review("never")]]).executor, disableHeartbeat: true,
        });
        check("12v) a failed token resolution NEVER reports a successful sync", out.ok === false);
        const acc = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: impP.accountId } });
        check("12w) no success marker was written", acc.lastSuccessfulSyncAt === null);
        check("12x) a bounded lastError is recorded with no provider text",
          !!acc.lastError && !acc.lastError.includes("ya29.") && !acc.lastError.includes(REFRESH));
        check("12y) no content was ingested",
          (await withTenant(P.tenantId, (db) => db.contentItem.count({ where: { connectedAccountId: impP.accountId } }))) === 0);
        check("12z) monitoring was NOT activated by a failed sync",
          (await activateGoogleBusinessMonitoring(P.tenantId, impP.accountId)).enabled === false);
      }
    }
    {
      // An unverified location fails closed and ingests nothing.
      const Q = await seedConnectedTenant("q", { accessExpiresAt: FUTURE }); tenants.push(Q.tenantId);
      const impQ = await importGoogleBusinessLocation({
        tenantId: Q.tenantId, brandId: Q.brandId,
        location: { providerLocationId: "LUNV", providerLocationName: "accounts/900/locations/LUNV", displayName: "Unverified", storeCode: null, addressSummary: null, providerAccountId: "900" },
        scopes: [SCOPE], maxPerBrand: null,
      });
      if (impQ.ok) {
        const out = await runReadOnlySync({ accountId: impQ.accountId, tenantId: Q.tenantId }, "manual", {
          googleDiscoveryClient: discoveryStub("LUNV", false), googleReviewExecutor: reviewExecutor([[review("nope")]]).executor, disableHeartbeat: true,
        });
        check("12aa) a location that lost verification fails closed", out.ok === false);
        check("12bb) nothing was ingested from it",
          (await withTenant(Q.tenantId, (db) => db.contentItem.count({ where: { connectedAccountId: impQ.accountId } }))) === 0);
      }
    }
    {
      // An active lease prevents an overlapping sync.
      const g = gsync([[review("g1")]], { forceLeaseUnavailable: true });
      const out = await runReadOnlySync({ accountId: accM, tenantId: M.tenantId }, "automatic", g.hooks);
      check("12cc) an active lease prevents an overlapping sync", out.verdict === "skipped_locked");
      check("12dd) the blocked attempt performed no provider call", g.ex.calls() === 0);
    }

  } finally {
    for (const t of tenants) {
      await systemDb.auditLog.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.reputationItem.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.contentItem.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.syncRun.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.syncLease.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.providerCredential.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.businessPlatformConnection.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.brand.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.deleteMany({ where: { id: t } }).catch(() => {});
    }
  }

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Google Business Slice 3A sync  [${pass} passed, ${fail} failed]`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
