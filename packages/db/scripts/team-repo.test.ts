/**
 * V1.71 (Release B / B4) — team invite + seat enforcement integration tests (REAL local Postgres, TWO
 * tenants). Seed as owner (systemDb); prove RLS as tamanor_app. Covers the full required matrix: invite
 * within/over limit, pending counts as seat, revoked/expired release the seat, duplicate pending, token
 * expiration/reuse, wrong email/tenant, accept idempotency, concurrent final-seat, last-owner guard,
 * downgrade determinism, RLS isolation, and the full happy path.
 * Run: pnpm team-repo:test  (needs DATABASE_URL=local owner + APP_DATABASE_URL=tamanor_app)
 */
import { PrismaClient } from "@prisma/client";
import {
  systemDb, withTenantDb,
  createInvite, acceptInvite, revokeInvite, removeMember, changeMemberRole, getSeatSummary, expireStaleInvites,
} from "@guardora/db";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("REFUSING: DATABASE_URL not local"); process.exit(1); }
let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); if (!c) failures++; };
function appUrl(): string {
  const a = process.env.APP_DATABASE_URL; if (a && a !== DB) return a;
  return DB.replace(/\/\/([^:@/]+):[^@]*@/, (_m, u: string) => { const d = u.indexOf("."); return `//tamanor_app${d >= 0 ? u.slice(d) : ""}:tamanor_app@`; });
}
const mkUser = (sfx: string, n: number) => systemDb.user.create({ data: { email: `tm${n}-${sfx}@t.local` } });

async function run() {
  const app = new PrismaClient({ datasourceUrl: appUrl() });
  const sfx = Date.now().toString(36);
  // Tenant A: starter → maxTeamMembers 3; billingStatus active → effective full_access.
  const A = await systemDb.tenant.create({ data: { name: "TmA", slug: `tm-a-${sfx}`, plan: "starter", billingStatus: "active", accessState: "full_access" } });
  const B = await systemDb.tenant.create({ data: { name: "TmB", slug: `tm-b-${sfx}`, plan: "starter", billingStatus: "active", accessState: "full_access" } });
  const owner = await mkUser(sfx, 0);
  const ownerM = await systemDb.membership.create({ data: { userId: owner.id, tenantId: A.id, role: "owner" } });
  const bOwner = await mkUser(sfx, 99);
  await systemDb.membership.create({ data: { userId: bOwner.id, tenantId: B.id, role: "owner" } });

  const createdUserIds: string[] = [owner.id, bOwner.id];
  try {
    // 1) invalid role + within-limit invite ---------------------------------------------------------
    check("invalid role rejected", (await createInvite(A.id, { email: `x-${sfx}@t.local`, role: "owner", invitedByUserId: owner.id })).ok === false);
    const inv1 = await createInvite(A.id, { email: `Alice-${sfx}@T.local`, role: "admin", invitedByUserId: owner.id });
    check("invite within limit → ok + token", inv1.ok === true && !!(inv1.ok && inv1.token));

    // 2) pending counts as a seat -------------------------------------------------------------------
    const sum = await getSeatSummary(A.id);
    check("seat usage counts owner + pending invite (1+1=2 of 3)", sum.usage === 2 && sum.activeMembers === 1 && sum.pendingInvites === 1 && sum.maxSeats === 3);

    // 3) duplicate pending invite -------------------------------------------------------------------
    check("duplicate pending invite (same email) → already_invited", (await createInvite(A.id, { email: `alice-${sfx}@t.local`, role: "viewer", invitedByUserId: owner.id })).ok === false);

    // 4) fill to the limit, then over-limit ---------------------------------------------------------
    const inv2 = await createInvite(A.id, { email: `bob-${sfx}@t.local`, role: "viewer", invitedByUserId: owner.id });
    check("second invite fills the plan (usage 3/3)", inv2.ok === true && (await getSeatSummary(A.id)).usage === 3);
    check("invite OVER the seat limit → seat_limit_reached", (await createInvite(A.id, { email: `carol-${sfx}@t.local`, role: "viewer", invitedByUserId: owner.id })).ok === false && ((await createInvite(A.id, { email: `carol2-${sfx}@t.local`, role: "viewer", invitedByUserId: owner.id }) as { reason?: string }).reason ?? "") === "seat_limit_reached");

    // 5) revoke releases the seat -------------------------------------------------------------------
    const inv2Id = inv2.ok ? inv2.inviteId : "";
    check("revoke pending invite → 1 changed", (await revokeInvite(A.id, inv2Id, owner.id)) === 1);
    check("after revoke a new invite fits again", (await createInvite(A.id, { email: `dave-${sfx}@t.local`, role: "viewer", invitedByUserId: owner.id })).ok === true);

    // 6) expiry releases the seat -------------------------------------------------------------------
    // Force the just-created 'dave' invite to be expired, then sweep.
    await systemDb.invite.updateMany({ where: { tenantId: A.id, emailNormalized: `dave-${sfx}@t.local`, status: "pending" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    check("expireStaleInvites marks it expired (≥1)", (await expireStaleInvites()) >= 1);
    check("expired invite freed a seat (usage back to 2)", (await getSeatSummary(A.id)).usage === 2);

    // 7) accept flow: expiration, wrong email, happy path, idempotency ------------------------------
    // Fresh invite for accept tests.
    const acceptInv = await createInvite(A.id, { email: `Eve-${sfx}@t.local`, role: "reviewer", invitedByUserId: owner.id });
    const token = acceptInv.ok ? acceptInv.token : "";
    const eve = await mkUser(sfx, 1); createdUserIds.push(eve.id);
    // wrong email
    check("accept with WRONG email → wrong_email", (await acceptInvite(token, eve.id, `not-eve-${sfx}@t.local`)).reason === "wrong_email");
    // wrong/garbage token
    check("accept with unknown token → not_found", (await acceptInvite("garbage_token", eve.id, `eve-${sfx}@t.local`)).reason === "not_found");
    // happy path
    const acc = await acceptInvite(token, eve.id, `eve-${sfx}@t.local`);
    check("accept (correct token+email) → ok, membership created, role reviewer", acc.ok === true && acc.ok && acc.tenantId === A.id && acc.role === "reviewer" && (await systemDb.membership.count({ where: { userId: eve.id, tenantId: A.id, role: "reviewer" } })) === 1);
    // idempotency / single-use
    const acc2 = await acceptInvite(token, eve.id, `eve-${sfx}@t.local`);
    check("accept AGAIN (same user) → idempotent ok, still ONE membership", acc2.ok === true && (await systemDb.membership.count({ where: { userId: eve.id, tenantId: A.id } })) === 1);
    check("invite is single-use (status accepted)", (await systemDb.invite.findFirst({ where: { tenantId: A.id, emailNormalized: `eve-${sfx}@t.local` }, select: { status: true } }))?.status === "accepted");
    // expired accept — free a seat first (revoke the still-pending 'alice' invite so 'frank' fits).
    await revokeInvite(A.id, inv1.ok ? inv1.inviteId : "", owner.id);
    const expInv = await createInvite(A.id, { email: `Frank-${sfx}@t.local`, role: "viewer", invitedByUserId: owner.id });
    check("frank invite created (seat freed by revoking alice)", expInv.ok === true);
    const fToken = expInv.ok ? expInv.token : "";
    await systemDb.invite.updateMany({ where: { tenantId: A.id, emailNormalized: `frank-${sfx}@t.local` }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const frank = await mkUser(sfx, 2); createdUserIds.push(frank.id);
    check("accept EXPIRED invite → expired", (await acceptInvite(fToken, frank.id, `frank-${sfx}@t.local`)).reason === "expired");

    // 8) concurrent final-seat ----------------------------------------------------------------------
    // Reset A to owner-only (remove eve) so exactly ONE seat is free after one pending... simplest: use a
    // fresh tenant C with free_trial (maxSeats 2): owner uses 1 → exactly one seat free.
    const C = await systemDb.tenant.create({ data: { name: "TmC", slug: `tm-c-${sfx}`, plan: "free_trial", billingStatus: "active", accessState: "full_access" } });
    const cOwner = await mkUser(sfx, 3); createdUserIds.push(cOwner.id);
    await systemDb.membership.create({ data: { userId: cOwner.id, tenantId: C.id, role: "owner" } });
    const [c1, c2] = await Promise.all([
      createInvite(C.id, { email: `race1-${sfx}@t.local`, role: "viewer", invitedByUserId: cOwner.id }),
      createInvite(C.id, { email: `race2-${sfx}@t.local`, role: "viewer", invitedByUserId: cOwner.id }),
    ]);
    check("concurrent final-seat: exactly ONE invite wins, the other is seat_limit_reached",
      [c1.ok, c2.ok].filter(Boolean).length === 1 && (await getSeatSummary(C.id)).usage === 2);

    // 9) last-owner guard ---------------------------------------------------------------------------
    check("cannot REMOVE the last owner", (await removeMember(A.id, ownerM.id, owner.id)).ok === false);
    check("cannot DEMOTE the last owner", (await changeMemberRole(A.id, ownerM.id, "viewer", owner.id)).ok === false);

    // 10) downgrade determinism ---------------------------------------------------------------------
    // A currently: owner + eve(reviewer) = 2 members. Downgrade to free_trial won't be over (max 2). Add a
    // 3rd member, then downgrade A to free_trial (maxSeats 2) → over-limit by 1, flagged = newest non-owner.
    const gid = await mkUser(sfx, 4); createdUserIds.push(gid.id);
    const gM = await systemDb.membership.create({ data: { userId: gid.id, tenantId: A.id, role: "viewer", createdAt: new Date() } });
    await systemDb.tenant.update({ where: { id: A.id }, data: { plan: "free_trial" } });
    const dsum = await getSeatSummary(A.id);
    check("downgrade: overLimit true (3 members > 2 seats), owner never flagged, newest flagged",
      dsum.overLimit === true && dsum.overLimitMemberIds.length === 1 && dsum.overLimitMemberIds[0] === gM.id && !dsum.overLimitMemberIds.includes(ownerM.id));
    check("downgrade never deleted a member (still 3 memberships)", (await systemDb.membership.count({ where: { tenantId: A.id } })) === 3);

    // 11) RLS isolation via tamanor_app -------------------------------------------------------------
    const forced: Array<{ f: boolean }> = await app.$queryRawUnsafe(`SELECT relforcerowsecurity AS f FROM pg_class WHERE relname='invites'`);
    check("RLS: FORCE row security active on invites", forced[0]?.f === true);
    const aInvites = await withTenantDb(A.id, (db) => db.invite.findMany(), app);
    check("RLS: A-context sees only A's invites (forgotten tenantId isolated)", aInvites.every((i) => i.tenantId === A.id) && aInvites.length > 0);
    check("RLS: A-context cannot read B's invites", (await withTenantDb(A.id, (db) => db.invite.findMany({ where: { tenantId: B.id } }), app)).length === 0);
    // wrong tenant: revoking A's invite from a B context affects 0 rows.
    check("wrong tenant: revoke of A's invite scoped to B changes nothing", (await revokeInvite(B.id, inv1.ok ? inv1.inviteId : "x", bOwner.id)) === 0);
  } finally {
    await app.$disconnect();
    for (const id of [A.id, B.id]) {
      await systemDb.invite.deleteMany({ where: { tenantId: id } });
      await systemDb.membership.deleteMany({ where: { tenantId: id } });
    }
    await systemDb.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
    await systemDb.invite.deleteMany({ where: { tenantId: { contains: `tm-c-${sfx}` } } }).catch(() => {});
    await systemDb.tenant.deleteMany({ where: { slug: { in: [`tm-a-${sfx}`, `tm-b-${sfx}`, `tm-c-${sfx}`] } } });
    await systemDb.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — team invites + seats + RLS (V1.71 B4)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(String(e).slice(0, 600)); await systemDb.$disconnect(); process.exit(1); });
