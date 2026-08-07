/**
 * GOOGLE BUSINESS SLICE 2 — location import into ConnectedAccount (local Postgres integration).
 *
 * Proves against a REAL database that a selected Business Profile location becomes an ordinary
 * ConnectedAccount on the EXISTING model — correct provider identity and normalized display metadata,
 * idempotent, concurrency-safe, reconnect-safe, tenant-isolated, respecting the existing per-brand
 * uniqueness and entitlement rules — and that the connection's capability set is only ever widened to
 * something the connector genuinely does.
 *
 * Run via: pnpm google-business-import-repo:test
 */
import { createHash } from "node:crypto";
process.env.PROVIDER_VAULT_KEK = createHash("sha256").update("gbp-slice2-test-kek").digest("base64");

import {
  systemDb, importGoogleBusinessLocation, assertGoogleBusinessCapabilities,
  GOOGLE_BUSINESS_EARNED_CAPABILITIES, persistGoogleBusinessGrant, activateGoogleBusinessConnection,
} from "../src/index";
import { BusinessConnectionCapability, BusinessConnectionStatus, ConnectorMode, ConnectorStatus } from "@prisma/client";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const rnd = () => Math.random().toString(36).slice(2, 10);

const location = (id: string, over: Partial<{ displayName: string; storeCode: string | null; addressSummary: string | null; providerAccountId: string }> = {}) => ({
  providerLocationId: id,
  providerLocationName: `accounts/900/locations/${id}`,
  displayName: `Northwind ${id}`,
  storeCode: `SC-${id}`,
  addressSummary: "Ulice 1, Praha",
  providerAccountId: "900",
  ...over,
});

async function seedTenant() {
  const slug = `gbp2-${rnd()}`;
  const t = await systemDb.tenant.create({ data: { slug, name: slug, plan: "growth", workspaceKind: "business" } });
  const b = await systemDb.brand.create({ data: { tenantId: t.id, name: `Brand ${slug}` } });
  const b2 = await systemDb.brand.create({ data: { tenantId: t.id, name: `Brand2 ${slug}` } });
  return { tenantId: t.id, brandId: b.id, brand2Id: b2.id };
}

async function main() {
  console.log("\nGoogle Business Slice 2 — location import into ConnectedAccount\n");
  const tenants: string[] = [];
  try {
    const A = await seedTenant(); tenants.push(A.tenantId);
    const B = await seedTenant(); tenants.push(B.tenantId);
    const imp = (t: typeof A, loc: ReturnType<typeof location>, maxPerBrand: number | null = null, brandId = t.brandId) =>
      importGoogleBusinessLocation({ tenantId: t.tenantId, brandId, location: loc, scopes: ["https://www.googleapis.com/auth/business.manage"], maxPerBrand });

    // ---- 1) Single import ------------------------------------------------------------------------
    console.log("1) Single location import");
    const r1 = await imp(A, location("L1"));
    check("1a) import succeeds and is not a reconnect", r1.ok === true && r1.ok && r1.reconnected === false);
    if (!r1.ok) throw new Error("cannot continue");
    const acc1 = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: r1.accountId } });
    check("1b) uses the EXISTING ConnectedAccount model with the google_business platform", acc1.platform === "google_business");
    check("1c) provider identity is the location id", acc1.externalId === "L1");
    check("1d) normalized display name is persisted", acc1.externalName === "Northwind L1");
    check("1e) connector is active and READ-ONLY", acc1.status === ConnectorStatus.active && acc1.mode === ConnectorMode.read_only);
    check("1f) connect is not monitor — background sync stays Slice 3", acc1.monitoringEnabled === false);
    check("1g) Meta-specific columns are untouched", acc1.pageId === null && acc1.igBusinessId === null);
    check("1h) NO token is written to any legacy column",
      acc1.accessToken === null && acc1.refreshToken === null && acc1.longLivedToken === null);
    check("1i) the row is tenant-scoped", acc1.tenantId === A.tenantId && acc1.brandId === A.brandId);
    const audit1 = await systemDb.auditLog.findFirst({ where: { tenantId: A.tenantId, event: "google_business.location.connected" } });
    check("1j) a connect audit record is written", audit1 !== null);
    check("1k) audit metadata carries no token material", !JSON.stringify(audit1?.metadata ?? {}).toLowerCase().includes("token"));

    // ---- 2) Multi-location import ----------------------------------------------------------------
    console.log("\n2) Multi-location import");
    const multi = await Promise.all([imp(A, location("L2")), imp(A, location("L3"))]);
    check("2a) several locations import independently", multi.every((r) => r.ok));
    check("2b) each becomes its own ConnectedAccount",
      (await systemDb.connectedAccount.count({ where: { tenantId: A.tenantId, platform: "google_business" as never } })) === 3);
    check("2c) identities are distinct",
      new Set((await systemDb.connectedAccount.findMany({ where: { tenantId: A.tenantId, platform: "google_business" as never }, select: { externalId: true } })).map((a) => a.externalId)).size === 3);

    // ---- 3) Idempotency --------------------------------------------------------------------------
    console.log("\n3) Idempotency");
    const again = await imp(A, location("L1", { displayName: "Northwind L1 RENAMED" }));
    check("3a) re-importing the same location is a RECONNECT, not a duplicate", again.ok === true && again.ok && again.reconnected === true);
    check("3b) it converges on the SAME ConnectedAccount row", again.ok && again.accountId === r1.accountId);
    check("3c) still exactly one row for that location",
      (await systemDb.connectedAccount.count({ where: { brandId: A.brandId, platform: "google_business" as never, externalId: "L1" } })) === 1);
    check("3d) a renamed location refreshes its label in place",
      (await systemDb.connectedAccount.findFirstOrThrow({ where: { id: r1.accountId } })).externalName === "Northwind L1 RENAMED");
    check("3e) the reconnect is audited as a reconnect",
      (await systemDb.auditLog.count({ where: { tenantId: A.tenantId, event: "google_business.location.reconnected" } })) === 1);

    // ---- 4) Concurrency --------------------------------------------------------------------------
    console.log("\n4) Concurrency");
    const C = await seedTenant(); tenants.push(C.tenantId);
    const racers = await Promise.all([
      imp(C, location("RACE")), imp(C, location("RACE")), imp(C, location("RACE")),
      imp(C, location("RACE")), imp(C, location("RACE")),
    ]);
    check("4a) every concurrent import succeeds", racers.every((r) => r.ok));
    const raceIds = new Set(racers.filter((r): r is Extract<typeof r, { ok: true }> => r.ok).map((r) => r.accountId));
    check("4b) all of them converge on ONE ConnectedAccount", raceIds.size === 1, `distinct=${raceIds.size}`);
    check("4c) the database holds exactly one row",
      (await systemDb.connectedAccount.count({ where: { brandId: C.brandId, platform: "google_business" as never, externalId: "RACE" } })) === 1);

    // ---- 5) Tenant isolation ---------------------------------------------------------------------
    console.log("\n5) Tenant isolation");
    const rB = await imp(B, location("L1"));
    check("5a) the SAME provider location id in another tenant creates a SEPARATE account",
      rB.ok === true && rB.ok && rB.accountId !== r1.accountId);
    if (rB.ok) {
      const accB = await systemDb.connectedAccount.findFirstOrThrow({ where: { id: rB.accountId } });
      check("5b) it belongs to the other tenant and brand", accB.tenantId === B.tenantId && accB.brandId === B.brandId);
      check("5c) it is NOT a reconnect of the first tenant's account", rB.reconnected === false);
    }
    check("5d) tenant A still has exactly three google_business accounts",
      (await systemDb.connectedAccount.count({ where: { tenantId: A.tenantId, platform: "google_business" as never } })) === 3);
    check("5e) an import into a brand of ANOTHER tenant is refused",
      (await importGoogleBusinessLocation({ tenantId: A.tenantId, brandId: B.brandId, location: location("X9"), scopes: [], maxPerBrand: null })).ok === false);
    check("5f) that refusal created nothing",
      (await systemDb.connectedAccount.count({ where: { externalId: "X9" } })) === 0);

    // ---- 6) Existing entitlement / uniqueness rules -----------------------------------------------
    console.log("\n6) Existing per-brand rules preserved");
    const D = await seedTenant(); tenants.push(D.tenantId);
    const d1 = await imp(D, location("D1"), 1);
    const d2 = await imp(D, location("D2"), 1);
    check("6a) the first location fits the per-brand cap", d1.ok === true);
    check("6b) a SECOND location in the same brand is refused by the existing cap",
      d2.ok === false && !d2.ok && d2.reason === "brand_platform_limit_reached");
    check("6c) the refused location created no row", (await systemDb.connectedAccount.count({ where: { brandId: D.brandId, externalId: "D2" } })) === 0);
    check("6d) reconnecting the SAME location never counts against its own slot",
      (await imp(D, location("D1"), 1)).ok === true);
    check("6e) the second location fits in a DIFFERENT brand",
      (await imp(D, location("D2"), 1, D.brand2Id)).ok === true);
    check("6f) an unbounded plan accepts several in one brand",
      (await imp(A, location("L4"), null)).ok === true);

    // ---- 7) Capability -----------------------------------------------------------------------------
    console.log("\n7) Truthful capability assertion");
    const E = await seedTenant(); tenants.push(E.tenantId);
    const grant = await persistGoogleBusinessGrant({
      tenantId: E.tenantId,
      credentials: { refreshToken: "1//gbp2-refresh", accessToken: "ya29.gbp2-access", accessTokenExpiresAt: new Date(Date.UTC(2027, 0, 1)), tokenType: "Bearer", scopes: ["https://www.googleapis.com/auth/business.manage"] },
    });
    if (!grant.ok) throw new Error("grant setup failed");
    await activateGoogleBusinessConnection({ tenantId: E.tenantId, connectionId: grant.connectionId, status: BusinessConnectionStatus.active });
    const preCaps = await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { id: grant.connectionId } });
    check("7a) Slice 1 left the capability set empty", preCaps.capabilities.length === 0);

    const caps = await assertGoogleBusinessCapabilities(E.tenantId);
    check("7b) exactly ONE capability is asserted", caps.length === 1);
    check("7c) it is brand_monitoring — reading reviews to watch the brand", caps[0] === BusinessConnectionCapability.brand_monitoring);
    check("7d) comment_moderation is NOT claimed (no reply/hide implementation exists)",
      !caps.includes(BusinessConnectionCapability.comment_moderation));
    check("7e) lead_ingestion is NOT claimed (reviews are not leads)",
      !caps.includes(BusinessConnectionCapability.lead_ingestion));
    check("7f) the exported vocabulary matches what was asserted",
      GOOGLE_BUSINESS_EARNED_CAPABILITIES.length === 1 && GOOGLE_BUSINESS_EARNED_CAPABILITIES[0] === BusinessConnectionCapability.brand_monitoring);
    const capsAgain = await assertGoogleBusinessCapabilities(E.tenantId);
    check("7g) repeated assertion is idempotent — no accumulation", capsAgain.length === 1);
    const persisted = await systemDb.businessPlatformConnection.findFirstOrThrow({ where: { id: grant.connectionId } });
    check("7h) the capability is persisted on the EXISTING connection", persisted.capabilities.length === 1 && persisted.capabilities[0] === BusinessConnectionCapability.brand_monitoring);
    check("7i) a tenant with no Google connection asserts nothing",
      (await assertGoogleBusinessCapabilities(A.tenantId)).length === 0);

    // ---- 8) Malformed input ------------------------------------------------------------------------
    console.log("\n8) Malformed input");
    check("8a) an empty provider location id is refused", (await imp(A, location(""))).ok === false);
    check("8b) a non-existent brand is refused",
      (await importGoogleBusinessLocation({ tenantId: A.tenantId, brandId: "brand_does_not_exist", location: location("ZZ"), scopes: [], maxPerBrand: null })).ok === false);
    check("8c) neither created a row", (await systemDb.connectedAccount.count({ where: { externalId: { in: ["", "ZZ"] } } })) === 0);
  } finally {
    for (const t of tenants) {
      await systemDb.auditLog.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.providerCredential.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.businessPlatformConnection.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.brand.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.deleteMany({ where: { id: t } }).catch(() => {});
    }
  }

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — Google Business Slice 2 import  [${pass} passed, ${fail} failed]`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
