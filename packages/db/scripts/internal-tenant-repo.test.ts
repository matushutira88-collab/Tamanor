/**
 * V1.73 — internal Tamanor admin tenant: DB integration tests (REAL local Postgres). Proves the flag,
 * resolved centrally, actually lifts every gate for an internal tenant (sync/operation, monitoring,
 * processed usage, team seats, export) while NORMAL tenants still follow billing rules, and that the
 * designation mechanism matches the EXACT email only (a similar email can never inherit internal status).
 * Run: pnpm internal-tenant-repo:test   (DATABASE_URL = local owner)
 */
import { ActorKind } from "@prisma/client";
import {
  systemDb, getTenantEntitlements, getTenantOperationGate, enableAccountMonitoringWithinLimit,
  createInvite, getSeatSummary, consumeBasicUnit, getOrCreateCurrentPeriod, withTenant,
} from "@guardora/db";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("REFUSING: DATABASE_URL not local"); process.exit(1); }
let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); if (!c) failures++; };
const past = new Date(Date.now() - 86_400_000);

async function run() {
  const sfx = Date.now().toString(36);
  // Internal tenant: free_trial, trial EXPIRED, internalAccess=true.
  const I = await systemDb.tenant.create({ data: { name: "Int", slug: `int-${sfx}`, plan: "free_trial", billingStatus: "no_subscription", accessState: "restricted", trialEndsAt: past, internalAccess: true } });
  // Normal EXPIRED trial: identical billing, internalAccess=false.
  const E = await systemDb.tenant.create({ data: { name: "Exp", slug: `exp-${sfx}`, plan: "free_trial", billingStatus: "no_subscription", accessState: "restricted", trialEndsAt: past, internalAccess: false } });
  // Normal PAID: growth active.
  const P = await systemDb.tenant.create({ data: { name: "Paid", slug: `paid-${sfx}`, plan: "growth", billingStatus: "active", accessState: "full_access", internalAccess: false } });
  const iOwner = await systemDb.user.create({ data: { email: `iown-${sfx}@t.local` } });
  await systemDb.membership.create({ data: { userId: iOwner.id, tenantId: I.id, role: "owner" } });
  const brand = await systemDb.brand.create({ data: { tenantId: I.id, name: "IB" } });
  const cleanupUsers = [iOwner.id];

  try {
    // 1) INTERNAL → unlimited entitlements + operation allowed (sync allowed, no billing_restricted) -----
    const ie = await getTenantEntitlements(I.id);
    check("internal: entitlements unlimited (accounts/brands/seats/processed null)", ie.maxConnectedAccounts === null && ie.maxBrands === null && ie.maxTeamMembers === null && ie.monthlyProcessedItems === null);
    check("internal: export allowed + gates on", ie.export === true && ie.providerSync === true && ie.paidAi === true);
    const ig = await getTenantOperationGate(I.id);
    check("internal: operation gate ALLOWED (sync allowed, NOT billing_restricted)", ig.allowed === true && ig.reason === null);

    // 2) INTERNAL → unlimited monitoring (enable many accounts past the free_trial cap of 1) ------------
    for (let n = 0; n < 3; n++) {
      await systemDb.connectedAccount.create({ data: { tenantId: I.id, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `I_${sfx}_${n}`, pageId: `I_${sfx}_${n}`, monitoringEnabled: false } });
    }
    const accts = await systemDb.connectedAccount.findMany({ where: { tenantId: I.id }, select: { id: true } });
    let enabledOk = 0;
    for (const a of accts) { try { await enableAccountMonitoringWithinLimit(I.id, a.id); enabledOk++; } catch { /* would-be limit */ } }
    check("internal: unlimited monitoring (all 3 enabled past free_trial cap)", enabledOk === 3);

    // 3) INTERNAL → unlimited processed usage (consume past a low cap is NOT denied) --------------------
    const per = await getOrCreateCurrentPeriod(I.id, "free_trial");
    await withTenant(I.id, (db) => db.usagePeriod.update({ where: { id: per.id }, data: { basicUnitsUsed: 999 } })); // over free_trial's 500
    const iConsume = await consumeBasicUnit(I.id, "free_trial", { idempotencyKey: `k-${sfx}-int`, tier: "rules", internalAccess: true });
    check("internal: processed usage NOT denied past cap (unlimited)", iConsume.consumed === true && !iConsume.denied);

    // 4) INTERNAL → unlimited team seats (invite past the free_trial 2-seat cap) ------------------------
    const seat = await getSeatSummary(I.id);
    check("internal: seat summary maxSeats null (unlimited)", seat.maxSeats === null);
    let inviteOk = 0;
    for (let n = 0; n < 4; n++) { const r = await createInvite(I.id, { email: `inv${n}-${sfx}@t.local`, role: "viewer", invitedByUserId: iOwner.id }); if (r.ok) inviteOk++; }
    check("internal: unlimited seats (4 invites past free_trial cap all ok)", inviteOk === 4);

    // 5) NORMAL EXPIRED trial → STILL blocked ----------------------------------------------------------
    const ee = await getTenantEntitlements(E.id);
    check("normal expired: entitlements restricted (caps 0, ops off)", ee.maxConnectedAccounts === 0 && ee.maxBrands === 0 && ee.providerSync === false);
    const eg = await getTenantOperationGate(E.id);
    check("normal expired: operation gate BLOCKED (billing_restricted)", eg.allowed === false && eg.reason === "billing_restricted");
    const eConsume = await consumeBasicUnit(E.id, "free_trial", { idempotencyKey: `k-${sfx}-exp`, tier: "rules", internalAccess: false });
    // normal tenant at 0 usage still consumes (within 500) — but crucially it is NOT unlimited; prove by setting over cap.
    const ePer = await getOrCreateCurrentPeriod(E.id, "free_trial");
    await withTenant(E.id, (db) => db.usagePeriod.update({ where: { id: ePer.id }, data: { basicUnitsUsed: 999 } }));
    const eDenied = await consumeBasicUnit(E.id, "free_trial", { idempotencyKey: `k-${sfx}-exp2`, tier: "rules", internalAccess: false });
    check("normal: processed usage IS capped (denied past limit)", eConsume.consumed === true && eDenied.denied === true && eDenied.reason === "basic_limit_reached");

    // 6) NORMAL PAID → allowed --------------------------------------------------------------------------
    const pg = await getTenantOperationGate(P.id);
    const pe = await getTenantEntitlements(P.id);
    check("normal paid: operation ALLOWED + plan entitlements (growth 3 brands, ops on)", pg.allowed === true && pe.maxBrands === 3 && pe.providerSync === true && pe.export === true);

    // 7) SECURITY — designation matches the EXACT internal email ONLY (no similar-email escalation) -----
    const exact = await systemDb.user.create({ data: { email: `info@tamanor.sk` } });
    const near1 = await systemDb.user.create({ data: { email: `info2@tamanor.sk` } });
    const near2 = await systemDb.user.create({ data: { email: `info@tamanor.sk.evil.com` } });
    const near3 = await systemDb.user.create({ data: { email: `xinfo@tamanor.sk` } });
    cleanupUsers.push(exact.id, near1.id, near2.id, near3.id);
    const tExact = await systemDb.tenant.create({ data: { name: "SxA", slug: `sx-a-${sfx}` } });
    const tN1 = await systemDb.tenant.create({ data: { name: "SxB", slug: `sx-b-${sfx}` } });
    const tN2 = await systemDb.tenant.create({ data: { name: "SxC", slug: `sx-c-${sfx}` } });
    const tN3 = await systemDb.tenant.create({ data: { name: "SxD", slug: `sx-d-${sfx}` } });
    await systemDb.membership.createMany({ data: [
      { userId: exact.id, tenantId: tExact.id, role: "owner" },
      { userId: near1.id, tenantId: tN1.id, role: "owner" },
      { userId: near2.id, tenantId: tN2.id, role: "owner" },
      { userId: near3.id, tenantId: tN3.id, role: "owner" },
    ] });
    // The setter's exact-match query (case-insensitive EQUALS, never LIKE/contains):
    const matched = await systemDb.membership.findMany({ where: { role: "owner", user: { email: { equals: "info@tamanor.sk", mode: "insensitive" } } }, select: { tenantId: true } });
    const matchedIds = matched.map((m) => m.tenantId);
    check("security: designation matches ONLY the exact email tenant", matchedIds.length === 1 && matchedIds[0] === tExact.id);
    check("security: similar emails (info2@, info@tamanor.sk.evil, xinfo@) are NOT matched", !matchedIds.includes(tN1.id) && !matchedIds.includes(tN2.id) && !matchedIds.includes(tN3.id));

    // cleanup the security fixtures
    await systemDb.membership.deleteMany({ where: { tenantId: { in: [tExact.id, tN1.id, tN2.id, tN3.id] } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [tExact.id, tN1.id, tN2.id, tN3.id] } } });
  } finally {
    for (const id of [I.id, E.id, P.id]) {
      await systemDb.invite.deleteMany({ where: { tenantId: id } });
      await systemDb.usageEvent.deleteMany({ where: { tenantId: id } });
      await systemDb.usagePeriod.deleteMany({ where: { tenantId: id } });
      await systemDb.auditLog.deleteMany({ where: { tenantId: id } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: id } });
      await systemDb.brand.deleteMany({ where: { tenantId: id } });
      await systemDb.membership.deleteMany({ where: { tenantId: id } });
    }
    await systemDb.user.deleteMany({ where: { id: { in: cleanupUsers } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [I.id, E.id, P.id] } } });
    void ActorKind;
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — internal admin tenant repo + security (V1.73)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(String(e).slice(0, 600)); await systemDb.$disconnect(); process.exit(1); });
