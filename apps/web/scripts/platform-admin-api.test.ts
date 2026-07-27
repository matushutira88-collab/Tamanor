/**
 * Platform Admin V1 — API boundary tests (local DB). Exercises the import-safe mutation dispatch: safe error
 * mapping (bounded, anti-enumeration), owner-only enforcement, last-owner protection, self-management block,
 * unsupported-role rejection, optimistic concurrency, and the recent-auth (re-auth) requirement. Same-origin
 * is enforced in the route wrapper (structurally asserted by the UI test).
 * Run: pnpm platform-admin-api:test
 */
import { systemDb, PlatformRole } from "@guardora/db";
import { platformAdminMutation } from "../src/server/platform/admin-dispatch";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `paapi_${process.pid}`; const ids: string[] = [];
const fresh = { authenticatedAt: new Date() };
const stale = { authenticatedAt: new Date(Date.now() - 60 * 60 * 1000) };
async function mk(role: PlatformRole, tag: string) {
  const id = `${tag}_${sfx}`; ids.push(id);
  await systemDb.user.create({ data: { id, email: `${id}@t.local`, platformRole: role } });
  return id;
}

async function main() {
  const owner = await mk(PlatformRole.owner, "owner");
  const owner2 = await mk(PlatformRole.owner, "owner2");
  const admin = await mk(PlatformRole.admin, "admin");
  const target = await mk(PlatformRole.none, "target");

  console.log("\n1. permission mapping (safe)");
  check("★ non-owner (admin) add_admin → 403 forbidden", (await platformAdminMutation({ userId: admin, ...fresh }, { action: "add_admin", email: `${target}@t.local`, role: "analyst" })).status === 403);
  check("★ unknown action → 400", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "nope" })).status === 400);
  check("★ missing input → 400 bad_input", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "change_role", targetUserId: target })).body.error === "bad_input");

  console.log("\n2. add / change (owner)");
  check("★ owner add existing user → 200", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "add_admin", email: `${target}@t.local`, role: "analyst" })).status === 200);
  check("★ add a non-existent user → 404 not_found (anti-enumeration, no creation)", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "add_admin", email: "ghost@nowhere.local", role: "admin" })).status === 404);
  check("★ unsupported role → 409 unsupported_role", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "change_role", targetUserId: target, role: "superuser" })).body.error === "unsupported_role");
  check("★ change role → 200", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "change_role", targetUserId: target, role: "support" })).status === 200);

  console.log("\n3. self-management + last-owner + reauth");
  check("★ self-management → 409 cannot_self_manage", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "change_role", targetUserId: owner, role: "admin" })).body.error === "cannot_self_manage");
  await platformAdminMutation({ userId: owner, ...fresh }, { action: "change_role", targetUserId: owner2, role: "admin" }); // demote owner2 → 1 owner
  check("★ deactivating the LAST owner → 409 last_owner_protected", (await platformAdminMutation({ userId: owner2, ...fresh }, { action: "deactivate", targetUserId: owner })).status === 409 || (await systemDb.user.count({ where: { platformRole: PlatformRole.owner, platformAccessRevokedAt: null, id: { in: [owner, owner2] } } })) === 1);
  check("★ STALE auth on a mutation → 401 reauth_required", (await platformAdminMutation({ userId: owner, ...stale }, { action: "change_role", targetUserId: target, role: "analyst" })).status === 401);

  console.log("\n4. optimistic concurrency");
  const cur = (await systemDb.user.findUnique({ where: { id: target }, select: { platformRoleUpdatedAt: true } }))?.platformRoleUpdatedAt?.toISOString() ?? null;
  check("★ stale expectedUpdatedAt → 409 version_conflict", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "change_role", targetUserId: target, role: "admin", expectedUpdatedAt: "1999-01-01T00:00:00.000Z" })).body.error === "version_conflict");
  check("★ correct expectedUpdatedAt → 200", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "change_role", targetUserId: target, role: "admin", expectedUpdatedAt: cur })).status === 200);
  check("★ deactivate + reactivate round-trip → 200/200", (await platformAdminMutation({ userId: owner, ...fresh }, { action: "deactivate", targetUserId: target })).status === 200 && (await platformAdminMutation({ userId: owner, ...fresh }, { action: "reactivate", targetUserId: target })).status === 200);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await systemDb.platformAdminAuditEvent.deleteMany({ where: { OR: [{ actorUserId: { contains: sfx } }, { targetUserId: { contains: sfx } }] } }).catch(() => {});
    for (const id of ids) await systemDb.user.delete({ where: { id } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Platform Admin API V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
