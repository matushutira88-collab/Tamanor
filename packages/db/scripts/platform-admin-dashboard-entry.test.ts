/**
 * Platform-owner DASHBOARD ENTRY tests (local DB). Proves the owner-only visibility of the /dashboard "Platform
 * Administration" card and that it is decoupled from the /admin route guard:
 *   - a platform OWNER sees the card
 *   - a REVOKED (deactivated) owner does NOT see it (resolvePlatformRole collapses to none)
 *   - a normal TENANT admin (tenant membership role only, platformRole none) does NOT see it
 *   - direct /admin entry without platform authorization is DENIED (admin.access not satisfied)
 * Also: the metrics helper is capability-gated (a non-privileged caller throws) and returns bounded counts, and a
 * platform `admin` proves guard-vs-card independence (admin.access granted, but the owner-only card hidden).
 * Run: pnpm platform-admin-dashboard-entry:test
 */
import {
  systemDb, PlatformRole, resolvePlatformRole, resolvePlatformRoleDetailed, normalizePlatformRole, platformRoleSatisfies,
  canViewPlatformAdminEntry, buildPlatformAdminEntryDiagnostic, PLATFORM_ADMIN_ENTRY_EVENT, platformDashboardMetrics,
} from "@guardora/db";
import { WorkspaceKind } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }

const sfx = `pade_${process.pid}`; const ids: string[] = [];
async function mkUser(role: PlatformRole, tag: string, revoked = false) {
  const id = `${tag}_${sfx}`; ids.push(id);
  await systemDb.user.create({ data: { id, email: `${id}@t.local`, name: tag, platformRole: role, platformAccessRevokedAt: revoked ? new Date() : null } });
  return id;
}

async function main() {
  const owner = await mkUser(PlatformRole.owner, "owner");
  const revokedOwner = await mkUser(PlatformRole.owner, "revoked", true);
  const admin = await mkUser(PlatformRole.admin, "admin");
  const tenantAdmin = await mkUser(PlatformRole.none, "tenantadmin");

  // A tenant admin: real tenant membership role = admin, but NO platform role.
  const tId = `t_${sfx}`;
  await systemDb.tenant.create({ data: { id: tId, name: tId, slug: tId, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  await systemDb.membership.create({ data: { userId: tenantAdmin, tenantId: tId, role: "admin" as never } });

  console.log("\n1. owner-only card visibility (resolved fresh from platformRole)");
  const rOwner = await resolvePlatformRole(owner);
  const rRevoked = await resolvePlatformRole(revokedOwner);
  const rAdmin = await resolvePlatformRole(admin);
  const rTenantAdmin = await resolvePlatformRole(tenantAdmin);
  check("★ platform OWNER sees the card", canViewPlatformAdminEntry(rOwner) === true);
  check("★ REVOKED owner does NOT see the card (resolves to none)", rRevoked === PlatformRole.none && canViewPlatformAdminEntry(rRevoked) === false);
  check("★ normal TENANT admin does NOT see the card (tenant role is not platformRole)", rTenantAdmin === PlatformRole.none && canViewPlatformAdminEntry(rTenantAdmin) === false);
  check("★ platform ADMIN (non-owner) does NOT see the OWNER-only card", canViewPlatformAdminEntry(rAdmin) === false);

  console.log("\n2. /admin guard is INDEPENDENT of card visibility");
  // The /admin layout enforces `admin.access` (satisfied by owner/admin/analyst/support). Card is owner-only.
  check("★ direct /admin entry WITHOUT platform authorization is denied (tenant admin)", platformRoleSatisfies(rTenantAdmin, "admin.access") === false);
  check("★ revoked owner is denied /admin (admin.access not satisfied)", platformRoleSatisfies(rRevoked, "admin.access") === false);
  check("★ platform admin: /admin GRANTED yet OWNER card hidden (guard ≠ card)", platformRoleSatisfies(rAdmin, "admin.access") === true && canViewPlatformAdminEntry(rAdmin) === false);
  check("★ owner: /admin granted AND card shown", platformRoleSatisfies(rOwner, "admin.access") === true && canViewPlatformAdminEntry(rOwner) === true);

  console.log("\n3. dashboard metrics are capability-gated + bounded");
  check("★ non-privileged caller (tenant admin) is REFUSED metrics", await throws(() => platformDashboardMetrics(tenantAdmin)));
  check("★ revoked owner is REFUSED metrics", await throws(() => platformDashboardMetrics(revokedOwner)));
  const m = await platformDashboardMetrics(owner);
  check("★ owner gets bounded numeric counts (no PII fields)", typeof m.activeTenants === "number" && typeof m.activeUsers === "number" && typeof m.unresolvedSecurityIncidents === "number" && typeof m.recentAuditEvents === "number");
  check("★ counts are non-negative", m.activeTenants >= 0 && m.activeUsers >= 0 && m.unresolvedSecurityIncidents >= 0 && m.recentAuditEvents >= 0);
  check("★ metrics object exposes ONLY the four bounded counts", Object.keys(m).sort().join(",") === "activeTenants,activeUsers,recentAuditEvents,unresolvedSecurityIncidents");

  console.log("\n4. REAL Prisma enum round-trip through the DB (not a hand-written string)");
  // Persist via the actual PlatformRole enum, then read the value BACK as Postgres/Prisma returns it — this is
  // the exact pipeline the dashboard uses. Proves the stored representation is the lowercase label and that the
  // whole resolve→predicate chain lights the card for a genuine DB-sourced owner.
  const rt = `rt_${sfx}`; ids.push(rt);
  await systemDb.user.create({ data: { id: rt, email: `${rt}@t.local`, name: "rt", platformRole: PlatformRole.owner } });
  const readBack = await systemDb.user.findUnique({ where: { id: rt }, select: { platformRole: true } });
  check("★ value read back from DB IS the enum PlatformRole.owner", readBack?.platformRole === PlatformRole.owner);
  const rawText = await systemDb.$queryRawUnsafe<Array<{ r: string }>>(`SELECT "platformRole"::text AS r FROM users WHERE id = $1`, rt);
  check("★ stored ::text casing is exactly lowercase 'owner' (rules out OWNER/casing drift)", rawText[0]?.r === "owner");
  const rtRole = await resolvePlatformRole(rt);
  check("★ resolvePlatformRole(DB owner) === PlatformRole.owner AND canView true", rtRole === PlatformRole.owner && canViewPlatformAdminEntry(rtRole) === true);
  const rtDetail = await resolvePlatformRoleDetailed(rt);
  check("★ detailed: found, assignedRole owner, not revoked, rawRole 'owner'", rtDetail.found && rtDetail.assignedRole === PlatformRole.owner && rtDetail.accessRevoked === false && rtDetail.rawRole === "owner");

  console.log("\n5. normalization is representation-robust (defense-in-depth)");
  check("★ casing/whitespace tolerated → owner", normalizePlatformRole("OWNER") === PlatformRole.owner && normalizePlatformRole(" Owner ") === PlatformRole.owner);
  check("★ unknown / non-string / null → none (fail-closed, no foreign representation leaks in)", normalizePlatformRole("superuser") === PlatformRole.none && normalizePlatformRole({} as unknown) === PlatformRole.none && normalizePlatformRole(null) === PlatformRole.none);

  console.log("\n6. diagnostics distinguish the hidden-card causes (PII-free)");
  const revokedDetail = await resolvePlatformRoleDetailed(revokedOwner);
  check("★ revoked owner: assignedRole owner BUT accessRevoked true → effective none", revokedDetail.assignedRole === PlatformRole.owner && revokedDetail.accessRevoked === true && revokedDetail.role === PlatformRole.none);
  const missingDetail = await resolvePlatformRoleDetailed(`ghost_${sfx}`);
  check("★ missing user: not found → none (no error)", missingDetail.found === false && missingDetail.errored === false && missingDetail.role === PlatformRole.none);

  console.log("\n7. PLATFORM_ADMIN_ENTRY_EVALUATED diagnostic carries ALL required PII-free fields");
  const REQUIRED = ["deployment", "route", "hasPlatformRole", "normalizedRole", "assignedRole", "accessRevoked", "found", "errored", "canViewEntry"];
  const FORBIDDEN = ["email", "userId", "userid", "sessionToken", "token", "password", "databaseUrl", "url", "connectionString"];
  // Build from the SAME resolution the render uses, for both an owner and a revoked owner, and round-trip through
  // JSON (the exact serialization the log emits) to prove no field is dropped and no PII field appears.
  for (const [tag, detail, canView] of [["owner", rtDetail, true], ["revoked-owner", revokedDetail, false]] as const) {
    const payload = buildPlatformAdminEntryDiagnostic(detail, { deployment: "abc123", route: "/dashboard", canViewEntry: canView });
    const serialized = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    const missing = REQUIRED.filter((k) => !(k in serialized));
    const leaked = FORBIDDEN.filter((k) => k in serialized);
    check(`★ [${tag}] all 9 required fields survive JSON.stringify`, missing.length === 0, `missing: ${missing.join(",")}`);
    check(`★ [${tag}] event marker present`, serialized.evt === PLATFORM_ADMIN_ENTRY_EVENT);
    check(`★ [${tag}] NO PII/credential fields present`, leaked.length === 0, `leaked: ${leaked.join(",")}`);
    check(`★ [${tag}] booleans are real booleans (never undefined-dropped)`, typeof serialized.hasPlatformRole === "boolean" && typeof serialized.accessRevoked === "boolean" && typeof serialized.found === "boolean" && typeof serialized.errored === "boolean" && typeof serialized.canViewEntry === "boolean");
    check(`★ [${tag}] canViewEntry matches the render decision`, serialized.canViewEntry === canView);
  }
  // Cause-distinguishing content: owner vs revoked owner must be tellable apart from the payload alone.
  const ownerP = buildPlatformAdminEntryDiagnostic(rtDetail, { deployment: "d", route: "/dashboard", canViewEntry: true });
  const revokedP = buildPlatformAdminEntryDiagnostic(revokedDetail, { deployment: "d", route: "/dashboard", canViewEntry: false });
  check("★ revoked owner is distinguishable: assignedRole owner + accessRevoked true + canViewEntry false", revokedP.assignedRole === PlatformRole.owner && revokedP.accessRevoked === true && revokedP.canViewEntry === false);
  check("★ active owner is distinguishable: normalizedRole owner + accessRevoked false + canViewEntry true", ownerP.normalizedRole === PlatformRole.owner && ownerP.accessRevoked === false && ownerP.canViewEntry === true);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await systemDb.membership.deleteMany({ where: { tenantId: `t_${sfx}` } }).catch(() => {});
    await systemDb.tenant.deleteMany({ where: { id: `t_${sfx}` } }).catch(() => {});
    for (const id of ids) await systemDb.user.delete({ where: { id } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Platform Admin Dashboard Entry: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
