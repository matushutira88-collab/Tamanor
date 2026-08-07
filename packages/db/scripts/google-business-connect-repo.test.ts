/**
 * GOOGLE BUSINESS SLICE 1 — credential anchoring + vault persistence (local Postgres integration).
 *
 * Proves against a REAL database that: the grant is anchored on the EXISTING per-tenant
 * BusinessPlatformConnection (provider = google, no new table); both tokens land in the EXISTING
 * encrypted vault; expiry and scope metadata survive; NO plaintext token exists anywhere in the row;
 * tenants are isolated; a re-connect rotates in place rather than accumulating rows; and — the
 * lifecycle invariant — storing a credential NEVER produces a connected state on its own. Only the
 * separate promotion phase does, so a vault failure OR a discovery failure both leave `pending`.
 *
 * Run via: pnpm google-business-connect-repo:test
 */
import { createHash } from "node:crypto";
// Hermetic vault key — set BEFORE any vault import/call so store + resolve share one env-resolved KEK.
const TEST_KEK = createHash("sha256").update("gbp-slice1-test-kek").digest("base64");
process.env.PROVIDER_VAULT_KEK = TEST_KEK;

import {
  systemDb, persistGoogleBusinessGrant, activateGoogleBusinessConnection, markGoogleBusinessConnectionError,
  resolveProviderCredential, getProviderCredentialStatus, ProviderCredentialPurpose,
} from "../src/index";
import { BusinessProvider, BusinessConnectionStatus } from "@prisma/client";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const rnd = () => Math.random().toString(36).slice(2, 10);

const REFRESH_A = "1//gbp-refresh-A-DO-NOT-LEAK";
const ACCESS_A = "ya29.gbp-access-A-DO-NOT-LEAK";
const SCOPES = ["https://www.googleapis.com/auth/business.manage"];
const EXPIRES = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

const creds = (over: Partial<{ refreshToken: string; accessToken: string; accessTokenExpiresAt: Date; tokenType: string; scopes: string[] }> = {}) => ({
  refreshToken: REFRESH_A, accessToken: ACCESS_A, accessTokenExpiresAt: EXPIRES, tokenType: "Bearer", scopes: SCOPES, ...over,
});

/**
 * Mirrors the callback route's ORDERING exactly: persist the credential, run discovery, and promote ONLY
 * if discovery succeeded. `discoveryOk` stands in for the real `discoverGoogleBusinessScope` result so the
 * lifecycle can be exercised end-to-end without a network. If this helper and the route ever diverge, the
 * structural assertions in google-business-oauth-slice1.test.ts (D12a–D12g) catch it against the source.
 */
async function connectFlow(tenantId: string, credentials: ReturnType<typeof creds>, discoveryOk: boolean) {
  const persisted = await persistGoogleBusinessGrant({ tenantId, credentials });
  if (!persisted.ok) return { stage: "persist_failed" as const, connectionId: null };
  if (!discoveryOk) return { stage: "discovery_failed" as const, connectionId: persisted.connectionId };
  const activated = await activateGoogleBusinessConnection({ tenantId, connectionId: persisted.connectionId, status: BusinessConnectionStatus.active });
  return { stage: activated.ok ? ("connected" as const) : ("activation_failed" as const), connectionId: persisted.connectionId };
}

async function seedTenant() {
  const slug = `gbp-${rnd()}`;
  const t = await systemDb.tenant.create({ data: { slug, name: slug, plan: "growth", workspaceKind: "business" } });
  return t.id;
}

async function main() {
  console.log("\nGoogle Business Slice 1 — connection anchor + vault persistence\n");
  const tenants: string[] = [];
  try {
    const A = await seedTenant(); tenants.push(A);
    const B = await seedTenant(); tenants.push(B);

    // ---- 1) Happy path: anchor + both credentials ------------------------------------------------
    console.log("1) Grant persistence");
    const r1 = await persistGoogleBusinessGrant({ tenantId: A, credentials: creds(), displayName: "Northwind" });
    check("1a) persist succeeds and returns the connection id", r1.ok === true && !!(r1.ok && r1.connectionId));
    if (!r1.ok) throw new Error("cannot continue without a persisted grant");
    const connA = r1.connectionId;

    const rows = await systemDb.businessPlatformConnection.findMany({ where: { tenantId: A } });
    check("1b) exactly ONE connection row for the tenant", rows.length === 1);
    check("1c) provider is google on the EXISTING connection model", rows[0].provider === BusinessProvider.google);
    check("1d) storing a credential does NOT connect the tenant — still pending", rows[0].status === BusinessConnectionStatus.pending);
    check("1e) persist reports the real current status, not an aspirational one",
      r1.status === BusinessConnectionStatus.pending && r1.isNew === true);
    check("1f) capabilities are NOT claimed in slice 1", rows[0].capabilities.length === 0);

    const q = (purpose: ProviderCredentialPurpose, tenantId = A, connectionId = connA) =>
      ({ tenantId, provider: BusinessProvider.google, purpose, connection: { businessConnectionId: connectionId } });

    // ---- 2) Vault round-trip ---------------------------------------------------------------------
    console.log("\n2) Encrypted vault write/read");
    check("2a) refresh token resolves back to the exact plaintext", (await resolveProviderCredential(q(ProviderCredentialPurpose.refresh_token))) === REFRESH_A);
    check("2b) access token resolves back to the exact plaintext", (await resolveProviderCredential(q(ProviderCredentialPurpose.access_token))) === ACCESS_A);
    const vrows = await systemDb.providerCredential.findMany({ where: { tenantId: A, businessConnectionId: connA, revokedAt: null } });
    check("2c) exactly two active vault rows (one per purpose)", vrows.length === 2);
    check("2d) rows are anchored on the business connection, not a ConnectedAccount",
      vrows.every((v) => v.businessConnectionId === connA && v.connectedAccountId === null));
    const serialized = JSON.stringify(vrows);
    check("2e) NO plaintext token anywhere in the stored rows",
      !serialized.includes(REFRESH_A) && !serialized.includes(ACCESS_A) && !serialized.includes("gbp-refresh-A") && !serialized.includes("gbp-access-A"));
    check("2f) every row is enveloped (ciphertext + iv + authTag + wrapped data key)",
      vrows.every((v) => !!v.ciphertext && !!v.iv && !!v.authTag && !!v.wrappedDataKey));

    // ---- 3) Metadata fidelity --------------------------------------------------------------------
    console.log("\n3) Expiry + scope metadata");
    const stAccess = await getProviderCredentialStatus(q(ProviderCredentialPurpose.access_token));
    const stRefresh = await getProviderCredentialStatus(q(ProviderCredentialPurpose.refresh_token));
    check("3a) access token keeps its exact expiry", stAccess.expiresAt?.getTime() === EXPIRES.getTime());
    check("3b) refresh token has no invented expiry", stRefresh.expiresAt === null);
    check("3c) scope metadata preserved on BOTH credentials, unchanged business.manage",
      stAccess.scopes.join(" ") === SCOPES[0] && stRefresh.scopes.join(" ") === SCOPES[0]);
    check("3d) token type preserved", vrows.every((v) => v.tokenType === "Bearer"));
    check("3e) status is non-secret (no ciphertext exposed)", !("ciphertext" in (stAccess as object)) && !!stAccess.fingerprint);

    // ---- 3.5) LIFECYCLE: promotion is a separate phase, gated on discovery -----------------------
    // This is the invariant the slice exists to protect: a stored credential is NOT a connection.
    console.log("\n3.5) Lifecycle — never fake a connected state");
    check("3.5a) after credential storage alone the connection is still PENDING",
      (await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { id: connA } })).status === BusinessConnectionStatus.pending);

    // THE EXACT DEFECT BEING CORRECTED, run end-to-end on a FRESH tenant: exchange + vault write succeed,
    // then discovery fails. The full flow must leave the connection non-active.
    const D = await seedTenant(); tenants.push(D);
    const flowD = await connectFlow(D, creds({ refreshToken: "1//tenant-D-refresh", accessToken: "ya29.tenant-D-access" }), false);
    const rowD = await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { tenantId: D } });
    check("3.5b) NEW connection + discovery failure never becomes active",
      flowD.stage === "discovery_failed" && rowD.status === BusinessConnectionStatus.pending && rowD.status !== BusinessConnectionStatus.active);
    check("3.5c) that failed connect still left the credential safely encrypted in the vault",
      (await resolveProviderCredential(q(ProviderCredentialPurpose.refresh_token, D, flowD.connectionId!))) === "1//tenant-D-refresh");
    check("3.5c2) and it is genuinely encrypted — no plaintext in the row",
      !JSON.stringify(await systemDb.providerCredential.findMany({ where: { tenantId: D } })).includes("1//tenant-D-refresh"));

    // The discovery-succeeded path on the same fresh tenant: pending -> active.
    const flowD2 = await connectFlow(D, creds({ refreshToken: "1//tenant-D-refresh", accessToken: "ya29.tenant-D-access" }), true);
    check("3.5d) successful discovery promotes pending -> active",
      flowD2.stage === "connected"
      && (await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { tenantId: D } })).status === BusinessConnectionStatus.active);

    // Tenant A is promoted explicitly so the reconnect scenarios below start from a working connection.
    const act = await activateGoogleBusinessConnection({ tenantId: A, connectionId: connA, status: BusinessConnectionStatus.active });
    check("3.5d2) explicit promotion reports the new status", act.ok === true && act.ok && act.status === BusinessConnectionStatus.active);
    const promoted = await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { id: connA } });
    check("3.5e) promotion records verification and clears any error code",
      promoted.status === BusinessConnectionStatus.active && promoted.lastVerifiedAt !== null && promoted.lastErrorCode === null);
    check("3.5f) promotion did not touch the vault", (await systemDb.providerCredential.count({ where: { tenantId: A, businessConnectionId: connA, revokedAt: null } })) === 2);

    // ---- 4) Tenant isolation ---------------------------------------------------------------------
    console.log("\n4) Tenant isolation");
    const r2 = await persistGoogleBusinessGrant({ tenantId: B, credentials: creds({ refreshToken: "1//tenant-B-refresh", accessToken: "ya29.tenant-B-access" }) });
    check("4a) a second tenant gets its OWN connection", r2.ok === true && r2.ok && r2.connectionId !== connA);
    check("4b) tenant A's credential is not readable under tenant B", (await resolveProviderCredential(q(ProviderCredentialPurpose.refresh_token, B, connA))) === null);
    if (r2.ok) {
      check("4c) tenant B's credential is not readable under tenant A", (await resolveProviderCredential(q(ProviderCredentialPurpose.refresh_token, A, r2.connectionId))) === null);
      check("4d) tenant B resolves its own credential", (await resolveProviderCredential(q(ProviderCredentialPurpose.refresh_token, B, r2.connectionId))) === "1//tenant-B-refresh");
    }
    check("4e) tenant A still sees exactly one connection", (await systemDb.businessPlatformConnection.count({ where: { tenantId: A } })) === 1);
    check("4f) tenant B, never promoted, is PENDING — not active",
      (await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { tenantId: B } })).status === BusinessConnectionStatus.pending);

    // ---- 5) Reconnect rotates in place -----------------------------------------------------------
    console.log("\n5) Reconnect");
    const r3 = await persistGoogleBusinessGrant({ tenantId: A, credentials: creds({ refreshToken: "1//gbp-refresh-ROTATED", accessToken: "ya29.gbp-access-ROTATED" }) });
    check("5a) reconnect reuses the SAME connection (no duplicate anchor)", r3.ok === true && r3.ok && r3.connectionId === connA && r3.isNew === false);
    check("5b) still exactly two active vault rows after rotation",
      (await systemDb.providerCredential.count({ where: { tenantId: A, businessConnectionId: connA, revokedAt: null } })) === 2);
    check("5c) the NEW refresh token is what resolves", (await resolveProviderCredential(q(ProviderCredentialPurpose.refresh_token))) === "1//gbp-refresh-ROTATED");
    check("5d) still exactly one connection row", (await systemDb.businessPlatformConnection.count({ where: { tenantId: A } })) === 1);
    check("5e) a reconnect's persist phase leaves the working ACTIVE status untouched (no downgrade)",
      (await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { id: connA } })).status === BusinessConnectionStatus.active);
    // A full reconnect flow whose discovery fails: the previously working connection must survive.
    const flowA = await connectFlow(A, creds({ refreshToken: "1//gbp-refresh-RECONNECT", accessToken: "ya29.gbp-access-RECONNECT" }), false);
    check("5f) a reconnect whose DISCOVERY fails leaves the prior working connection ACTIVE",
      flowA.stage === "discovery_failed"
      && (await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { id: connA } })).status === BusinessConnectionStatus.active);
    check("5g) that reconnect still rotated to a usable credential (nothing invalidated)",
      (await resolveProviderCredential(q(ProviderCredentialPurpose.refresh_token))) === "1//gbp-refresh-RECONNECT"
      && (await systemDb.providerCredential.count({ where: { tenantId: A, businessConnectionId: connA, revokedAt: null } })) === 2);

    // ---- 6) FAIL-CLOSED: vault failure must never produce a connected state -----------------------
    console.log("\n6) Fail-closed staging");
    const C = await seedTenant(); tenants.push(C);
    delete process.env.PROVIDER_VAULT_KEK; // encryption can no longer be performed
    const r4 = await persistGoogleBusinessGrant({ tenantId: C, credentials: creds() });
    process.env.PROVIDER_VAULT_KEK = TEST_KEK;
    check("6a) a vault failure is reported, not swallowed", r4.ok === false && !r4.ok && r4.reason === "vault_write_failed");
    const cRows = await systemDb.businessPlatformConnection.findMany({ where: { tenantId: C } });
    check("6b) a vault failure never becomes active — the connection is left PENDING",
      cRows.length === 1 && cRows[0].status === BusinessConnectionStatus.pending && cRows[0].status !== BusinessConnectionStatus.active);
    check("6c) no credential row was left behind", (await systemDb.providerCredential.count({ where: { tenantId: C } })) === 0);
    check("6d) the failure result carries no token or key material", !JSON.stringify(r4).includes(REFRESH_A) && !JSON.stringify(r4).includes(TEST_KEK));

    // A failed reconnect must not downgrade a tenant that is already working.
    delete process.env.PROVIDER_VAULT_KEK;
    const r5 = await persistGoogleBusinessGrant({ tenantId: A, credentials: creds({ refreshToken: "1//never-stored" }) });
    process.env.PROVIDER_VAULT_KEK = TEST_KEK;
    check("6e) a failed RECONNECT does not downgrade the working connection",
      r5.ok === false && (await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { id: connA } })).status === BusinessConnectionStatus.active);
    check("6f) the failed reconnect did not replace the good credential",
      (await resolveProviderCredential(q(ProviderCredentialPurpose.refresh_token))) === "1//gbp-refresh-RECONNECT");

    // ---- 7) Bounded error marking ----------------------------------------------------------------
    console.log("\n7) Bounded error code");
    await markGoogleBusinessConnectionError(C, "discovery_failed");
    const cAfter = await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { tenantId: C } });
    check("7a) error status + bounded code recorded", cAfter.status === BusinessConnectionStatus.error && cAfter.lastErrorCode === "discovery_failed");
    await markGoogleBusinessConnectionError(C, "x".repeat(500));
    const cLong = await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { tenantId: C } });
    check("7b) an oversized code is truncated, never stored unbounded", (cLong.lastErrorCode ?? "").length === 64);
  } finally {
    process.env.PROVIDER_VAULT_KEK = TEST_KEK;
    for (const t of tenants) {
      await systemDb.providerCredential.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.businessPlatformConnection.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.deleteMany({ where: { id: t } }).catch(() => {});
    }
  }

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Google Business Slice 1 persistence  [${pass} passed, ${fail} failed]`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
