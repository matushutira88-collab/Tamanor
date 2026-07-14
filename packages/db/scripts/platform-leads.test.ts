/**
 * V1.45A — GLOBAL platform boundary & leads P0 closure (real Postgres).
 *
 * Proves: platform authorization is independent of tenant Role; ordinary tenant Owners (even owning
 * multiple tenants) cannot read or mutate the global leads table; only platform staff/admin can;
 * platform role is resolved fresh (removal denies immediately); the bootstrap assigns/removes safely;
 * denials carry no lead PII.
 *
 * Run: pnpm platform-leads:test
 */
import {
  systemDb,
  PlatformRole, resolvePlatformRole, platformRoleSatisfies, isPlatformForbidden, PlatformForbiddenError,
  platformListLeads, platformGroupLeadsByStatus, platformGetLeadById, platformUpdateLead,
  setPlatformRoleByEmail, createLead,
} from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function denied(fn: () => Promise<unknown>): Promise<{ blocked: boolean; err?: unknown }> {
  try { await fn(); return { blocked: false }; }
  catch (e) { return { blocked: isPlatformForbidden(e), err: e }; }
}

async function run() {
  const sfx = Date.now().toString(36);
  const mkUser = (tag: string, role: PlatformRole = PlatformRole.none) =>
    systemDb.user.create({ data: { email: `pl-${tag}-${sfx}@t.dev`, name: `PL ${tag}`, platformRole: role } });
  const mkTenant = (tag: string) => systemDb.tenant.create({ data: { name: `PL ${tag} ${sfx}`, slug: `pl-${tag}-${sfx}` } });

  const ownerA = await mkUser("ownerA");
  const ownerB = await mkUser("ownerB");
  const ownerBoth = await mkUser("ownerBoth");
  const ordinary = await mkUser("ordinary");
  const staff = await mkUser("staff", PlatformRole.staff);
  const admin = await mkUser("admin", PlatformRole.admin);
  const tenantA = await mkTenant("A");
  const tenantB = await mkTenant("B");
  await systemDb.membership.create({ data: { userId: ownerA.id, tenantId: tenantA.id, role: "owner" } });
  await systemDb.membership.create({ data: { userId: ownerB.id, tenantId: tenantB.id, role: "owner" } });
  await systemDb.membership.create({ data: { userId: ownerBoth.id, tenantId: tenantA.id, role: "owner" } });
  await systemDb.membership.create({ data: { userId: ownerBoth.id, tenantId: tenantB.id, role: "owner" } });
  const lead = await createLead({ name: `Prospect ${sfx}`, email: `prospect-${sfx}@example.com`, company: "Acme", message: "Please demo" });

  try {
    // ---------------- A) defaults: tenant role never grants platform access ----------------
    check("A1) newly created ordinary user defaults to PlatformRole.none", (await resolvePlatformRole(ordinary.id)) === PlatformRole.none);
    check("A2) tenant Owner has platform role none (owning a tenant does not elevate)", (await resolvePlatformRole(ownerA.id)) === PlatformRole.none);
    check("A3) creating tenants + owner memberships did not grant a platform role", (await resolvePlatformRole(ownerBoth.id)) === PlatformRole.none);
    await systemDb.membership.updateMany({ where: { userId: ownerA.id, tenantId: tenantA.id }, data: { role: "admin" } });
    check("A4) changing a tenant membership role does NOT change the platform role", (await resolvePlatformRole(ownerA.id)) === PlatformRole.none);
    await systemDb.membership.updateMany({ where: { userId: ownerA.id, tenantId: tenantA.id }, data: { role: "owner" } });

    // ---------------- C) service enforcement (the authoritative boundary) ----------------
    const list = await denied(() => platformListLeads(ownerA.id, {}));
    const get = await denied(() => platformGetLeadById(ownerA.id, lead.id));
    const upd = await denied(() => platformUpdateLead(ownerA.id, lead.id, { status: "contacted" }));
    const grp = await denied(() => platformGroupLeadsByStatus(ownerA.id));
    check("C1) tenant Owner DENIED platformListLeads (throws platform_forbidden)", list.blocked);
    check("C2) tenant Owner DENIED platformGetLeadById", get.blocked);
    check("C3) tenant Owner DENIED platformUpdateLead", upd.blocked);
    check("C4) tenant Owner DENIED platformGroupLeadsByStatus", grp.blocked);
    check("C5) unauthenticated / unknown userId resolves to none (fail-closed)", (await resolvePlatformRole("no-such-user")) === PlatformRole.none && (await resolvePlatformRole(null)) === PlatformRole.none);
    check("C6) unknown role value fails closed in the capability policy", platformRoleSatisfies("bogus" as unknown as PlatformRole, "leads:read") === false && platformRoleSatisfies(null, "leads:write") === false);

    // Allowed for platform staff/admin.
    const staffList = await platformListLeads(staff.id, {});
    const staffGet = await platformGetLeadById(staff.id, lead.id);
    const adminGrp = await platformGroupLeadsByStatus(admin.id);
    check("C7) platform STAFF may read + write leads", Array.isArray(staffList) && staffList.some((l) => l.id === lead.id) && staffGet?.id === lead.id && (await platformUpdateLead(staff.id, lead.id, { status: "contacted" })) !== undefined);
    check("C8) platform ADMIN may read leads", Array.isArray(adminGrp));

    // ---------------- E) cross-customer regression ----------------
    const bDenied = await denied(() => platformGetLeadById(ownerB.id, lead.id));
    const bothDenied = await denied(() => platformGetLeadById(ownerBoth.id, lead.id));
    check("E1) Owner A cannot access the lead", (await denied(() => platformGetLeadById(ownerA.id, lead.id))).blocked);
    check("E2) Owner B cannot access the lead", bDenied.blocked);
    check("E3) a user owning BOTH tenants still cannot access the lead", bothDenied.blocked);
    check("E4) the platform-authorized user CAN access the lead", (await platformGetLeadById(staff.id, lead.id))?.id === lead.id);

    // Removing the platform role denies access IMMEDIATELY (fresh resolution, no stale privilege).
    const removed = await setPlatformRoleByEmail(`pl-staff-${sfx}@t.dev`, PlatformRole.none);
    const afterRemoval = await denied(() => platformListLeads(staff.id, {}));
    check("E5) removing the platform role removes access immediately", removed.ok === true && (removed as { current: PlatformRole }).current === PlatformRole.none && afterRemoval.blocked && (await resolvePlatformRole(staff.id)) === PlatformRole.none);

    // No tenant membership manipulation grants platform access.
    await systemDb.membership.create({ data: { userId: ordinary.id, tenantId: tenantA.id, role: "owner" } });
    check("E6) adding an Owner membership does NOT grant platform access", (await resolvePlatformRole(ordinary.id)) === PlatformRole.none && (await denied(() => platformListLeads(ordinary.id, {}))).blocked);

    // ---------------- F) bootstrap ----------------
    const nf = await setPlatformRoleByEmail(`nobody-${sfx}@none.dev`, PlatformRole.admin);
    check("F1) bootstrap: user not found → no mutation", nf.ok === false && (nf as { reason: string }).reason === "user_not_found");
    const grant = await setPlatformRoleByEmail(`pl-ordinary-${sfx}@t.dev`, PlatformRole.staff);
    check("F2) bootstrap: assign STAFF persists (prev none → staff)", grant.ok === true && (grant as { previous: PlatformRole; current: PlatformRole }).previous === PlatformRole.none && (grant as { current: PlatformRole }).current === PlatformRole.staff && (await resolvePlatformRole(ordinary.id)) === PlatformRole.staff);
    const again = await setPlatformRoleByEmail(`pl-ordinary-${sfx}@t.dev`, PlatformRole.staff);
    check("F3) bootstrap: repeat assignment is idempotent", again.ok === true && (again as { previous: PlatformRole; current: PlatformRole }).previous === PlatformRole.staff && (again as { current: PlatformRole }).current === PlatformRole.staff);
    await setPlatformRoleByEmail(`pl-ordinary-${sfx}@t.dev`, PlatformRole.none);
    check("F4) bootstrap: set back to none removes access", (await resolvePlatformRole(ordinary.id)) === PlatformRole.none && (await denied(() => platformListLeads(ordinary.id, {}))).blocked);

    // ---------------- G) privacy: denials carry NO lead PII ----------------
    const errStr = JSON.stringify({ msg: (list.err as Error)?.message, cap: (list.err as PlatformForbiddenError)?.capability });
    check("G1) PlatformForbiddenError carries only 'platform_forbidden' + capability — no email/message/PII", (list.err as Error)?.message === "platform_forbidden" && !errStr.includes("prospect-") && !errStr.includes("Please demo") && !errStr.includes("@example.com"));
  } finally {
    await systemDb.lead.deleteMany({ where: { id: lead.id } });
    await systemDb.membership.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await systemDb.user.deleteMany({ where: { email: { contains: sfx } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Platform boundary & leads P0 (V1.45A)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
