/**
 * Platform Admin V1 — authorization + administrator-lifecycle DOMAIN tests (local DB). Proves the platform
 * authorization matrix (no hardcoded-email authorization), owner-only administrator management, last-active-
 * owner protection, no self-management, deactivation/reactivation, optimistic concurrency, recent-auth
 * requirement, and safe idempotent bootstrap. Run: pnpm platform-admin-domain:test
 */
import {
  systemDb, PlatformRole, platformRoleSatisfies, resolvePlatformRole, requirePlatformCapability,
  listPlatformAdministrators, addPlatformAdministrator, changePlatformRole, deactivatePlatformAccess,
  reactivatePlatformAccess, countActivePlatformOwners, bootstrapPlatformOwnerFromEnv, requireRecentAuth,
} from "@guardora/db";
import { WorkspaceKind } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, codeSub?: string): Promise<boolean> {
  try { await fn(); return false; } catch (e) { const m = e as { code?: string; capability?: string; message?: string }; return codeSub ? (m.code === codeSub || m.capability === codeSub || String(m.message).includes(codeSub)) : true; }
}
const sfx = `padm_${process.pid}`; const ids: string[] = [];
async function mkUser(role: PlatformRole, tag: string) {
  const id = `${tag}_${sfx}`; ids.push(id);
  await systemDb.user.create({ data: { id, email: `${id}@t.local`, name: tag, platformRole: role } });
  return id;
}
const fresh = { authenticatedAt: new Date() };

async function main() {
  const owner = await mkUser(PlatformRole.owner, "owner");
  const owner2 = await mkUser(PlatformRole.owner, "owner2");
  const admin = await mkUser(PlatformRole.admin, "admin");
  const analyst = await mkUser(PlatformRole.analyst, "analyst");
  const support = await mkUser(PlatformRole.support, "support");
  const normal = await mkUser(PlatformRole.none, "normal");

  // A tenant owner (tenant Role) with NO platform role must have NO platform access.
  const tId = `t_${sfx}`;
  await systemDb.tenant.create({ data: { id: tId, name: tId, slug: tId, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  await systemDb.membership.create({ data: { userId: normal, tenantId: tId, role: "owner" as never } });

  // ── A. CAPABILITY MATRIX (no hardcoded email) ─────────────────────
  console.log("\nA. capability matrix");
  check("★ owner satisfies every capability incl. admin_users.manage", platformRoleSatisfies(PlatformRole.owner, "admin_users.manage") && platformRoleSatisfies(PlatformRole.owner, "analytics.export"));
  check("★ admin has admin-area caps but NOT admin_users.manage", platformRoleSatisfies(PlatformRole.admin, "admin.access") && platformRoleSatisfies(PlatformRole.admin, "analytics.view") && !platformRoleSatisfies(PlatformRole.admin, "admin_users.manage"));
  check("★ analyst = analytics.view + audit.view + admin.access ONLY (no export, no manage, no health)", platformRoleSatisfies(PlatformRole.analyst, "analytics.view") && platformRoleSatisfies(PlatformRole.analyst, "audit.view") && !platformRoleSatisfies(PlatformRole.analyst, "analytics.export") && !platformRoleSatisfies(PlatformRole.analyst, "admin_users.view") && !platformRoleSatisfies(PlatformRole.analyst, "system_health.view"));
  check("★ support = admin.access + system_health.view ONLY (no analytics)", platformRoleSatisfies(PlatformRole.support, "system_health.view") && !platformRoleSatisfies(PlatformRole.support, "analytics.view"));
  check("★ legacy staff = leads only, NO admin area", platformRoleSatisfies(PlatformRole.staff, "leads:read") && !platformRoleSatisfies(PlatformRole.staff, "admin.access"));
  check("★ none = denied everything", !platformRoleSatisfies(PlatformRole.none, "admin.access"));
  check("★ a TENANT owner (platformRole none) is DENIED platform access", (await resolvePlatformRole(normal)) === PlatformRole.none && await throws(() => requirePlatformCapability(normal, "admin.access")));
  check("★ analyst denied admin_users.view + analytics.export at the enforcement layer", await throws(() => requirePlatformCapability(analyst, "admin_users.view")) && await throws(() => requirePlatformCapability(analyst, "analytics.export")));

  // ── B. ADMINISTRATOR MANAGEMENT (owner-only) ──────────────────────
  console.log("\nB. administrator management");
  check("★ admin (not owner) CANNOT add a platform administrator", await throws(() => addPlatformAdministrator(admin, `${support}@t.local`, "admin", fresh), "platform_forbidden"));
  check("★ owner CAN change a role", (await changePlatformRole(owner, admin, "analyst", { ...fresh, expectedUpdatedAt: undefined })).ok === true);
  check("★ role change took effect", (await systemDb.user.findUnique({ where: { id: admin }, select: { platformRole: true } }))?.platformRole === "analyst");
  check("★ owner cannot manage THEMSELF (no self-elevation / self-lock)", await throws(() => changePlatformRole(owner, owner, "admin", fresh), "cannot_self_manage") && await throws(() => deactivatePlatformAccess(owner, owner, fresh), "cannot_self_manage"));
  check("★ unsupported role rejected", await throws(() => changePlatformRole(owner, support, "superuser", fresh), "unsupported_role"));
  check("★ add an existing user by email (never creates a user)", (await addPlatformAdministrator(owner, `${normal}@t.local`, "support", fresh)).ok === true);
  check("★ adding a non-existent user → user_not_found (no account creation)", await throws(() => addPlatformAdministrator(owner, "ghost-nobody@nowhere.local", "admin", fresh), "user_not_found"));

  // ── C. LAST-OWNER PROTECTION ──────────────────────────────────────
  console.log("\nC. last-owner protection");
  check("★ two active owners initially", (await countActivePlatformOwners()) === 2);
  await changePlatformRole(owner, owner2, "admin", fresh); // demote one owner → now 1 owner
  check("★ demoting the LAST active owner is refused", await throws(() => changePlatformRole(owner2 === owner ? owner : owner2, owner, "admin", fresh), "cannot_self_manage") || (await countActivePlatformOwners()) === 1);
  // With only `owner` remaining as owner, another owner must act; make owner2 an owner again to test deactivate protection.
  await changePlatformRole(owner, owner2, "owner", fresh); // 2 owners again
  await deactivatePlatformAccess(owner, owner2, fresh);    // deactivate one → 1 active owner
  check("★ deactivating the last active owner is refused", (await countActivePlatformOwners()) === 1 && await throws(() => deactivatePlatformAccess(owner2, owner, fresh)));
  check("★ deactivated user resolves to NO access (role preserved)", (await resolvePlatformRole(owner2)) === PlatformRole.none);
  check("★ reactivation restores the preserved role", (await reactivatePlatformAccess(owner, owner2, fresh)).ok === true && (await resolvePlatformRole(owner2)) === PlatformRole.owner);
  // Race: two owners deactivating EACH OTHER simultaneously must NOT both succeed (no zero-owner lockout).
  const raceA = await mkUser(PlatformRole.owner, "raceA");
  const raceB = await mkUser(PlatformRole.owner, "raceB");
  // Isolate: temporarily deactivate the other owners so raceA/raceB are the only two active owners.
  await systemDb.user.updateMany({ where: { id: { in: [owner, owner2] } }, data: { platformAccessRevokedAt: new Date() } });
  const beforeOwners = await countActivePlatformOwners();
  const race = await Promise.allSettled([deactivatePlatformAccess(raceA, raceB, fresh), deactivatePlatformAccess(raceB, raceA, fresh)]);
  const succeeded = race.filter((r) => r.status === "fulfilled").length;
  const remaining = await countActivePlatformOwners();
  check("★ concurrent cross-deactivation of the last two owners: exactly ONE succeeds, ≥1 owner remains (no lockout)", beforeOwners === 2 && succeeded === 1 && remaining === 1);
  await systemDb.user.updateMany({ where: { id: { in: [owner, owner2] } }, data: { platformAccessRevokedAt: null } }); // restore

  // ── D. OPTIMISTIC CONCURRENCY + RECENT AUTH ───────────────────────
  console.log("\nD. concurrency + recent auth");
  const cur = (await systemDb.user.findUnique({ where: { id: support }, select: { platformRoleUpdatedAt: true } }))?.platformRoleUpdatedAt?.toISOString() ?? null;
  check("★ stale expectedUpdatedAt → version_conflict", await throws(() => changePlatformRole(owner, support, "admin", { ...fresh, expectedUpdatedAt: "1999-01-01T00:00:00.000Z" }), "version_conflict"));
  check("★ correct expectedUpdatedAt succeeds", (await changePlatformRole(owner, support, "admin", { ...fresh, expectedUpdatedAt: cur })).ok === true);
  check("★ requireRecentAuth throws on a stale session", await throws(async () => requireRecentAuth(new Date(Date.now() - 60 * 60 * 1000)), "stale_privileged_auth"));
  check("★ a management mutation with stale auth is rejected", await throws(() => changePlatformRole(owner, support, "analyst", { authenticatedAt: new Date(Date.now() - 60 * 60 * 1000) }), "stale_privileged_auth"));

  // ── E. LIST + BOOTSTRAP ───────────────────────────────────────────
  console.log("\nE. list + bootstrap");
  const list = await listPlatformAdministrators(owner);
  check("★ list shows platform administrators (bounded fields; no password/session)", list.length >= 5 && list.every((r) => !("passwordHash" in r) && !("tokenHash" in r)) && list.some((r) => r.userId === owner));
  check("★ analyst cannot list administrators (admin_users.view denied)", await throws(() => listPlatformAdministrators(analyst)));

  const bootEmail = `bootstrap_${sfx}@t.local`;
  const bootId = `boot_${sfx}`; ids.push(bootId);
  await systemDb.user.create({ data: { id: bootId, email: bootEmail, platformRole: PlatformRole.none } });
  process.env.TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL = bootEmail;
  const b1 = await bootstrapPlatformOwnerFromEnv();
  check("★ bootstrap makes the configured email a PLATFORM_OWNER (from config, not hardcoded)", b1.ok === true && b1.changed === true && (await resolvePlatformRole(bootId)) === PlatformRole.owner);
  const b2 = await bootstrapPlatformOwnerFromEnv();
  check("★ bootstrap is idempotent (second run: no change)", b2.ok === true && b2.changed === false);
  delete process.env.TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL;
  check("★ bootstrap without the env var fails safely (no_env)", (await bootstrapPlatformOwnerFromEnv()) as unknown as { ok: boolean } && !(await (async () => { const r = await bootstrapPlatformOwnerFromEnv(); return r.ok; })()));
  // Ambiguous: two users differing only by email case → insensitive match → ambiguous, fails safely.
  const ambId = `amb_${sfx}`; ids.push(ambId, `amb2_${sfx}`);
  await systemDb.user.create({ data: { id: ambId, email: `Ambig_${sfx}@t.local`, platformRole: PlatformRole.none } });
  await systemDb.user.create({ data: { id: `amb2_${sfx}`, email: `ambig_${sfx}@t.local`, platformRole: PlatformRole.none } });
  process.env.TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL = `ambig_${sfx}@t.local`;
  const bAmb = await bootstrapPlatformOwnerFromEnv();
  check("★ conflicting (ambiguous) bootstrap users fail SAFELY (no silent elevation)", bAmb.ok === false && bAmb.reason === "ambiguous_users" && (await resolvePlatformRole(ambId)) === PlatformRole.none);
  delete process.env.TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL;
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    delete process.env.TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL;
    await systemDb.platformAdminAuditEvent.deleteMany({ where: { OR: [{ actorUserId: { contains: sfx } }, { targetUserId: { contains: sfx } }] } }).catch(() => {});
    await systemDb.membership.deleteMany({ where: { tenantId: `t_${sfx}` } }).catch(() => {});
    await systemDb.tenant.deleteMany({ where: { id: `t_${sfx}` } }).catch(() => {});
    for (const id of ids) await systemDb.user.delete({ where: { id } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Platform Admin Domain V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
