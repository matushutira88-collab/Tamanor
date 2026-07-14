/**
 * V1.45C2 — USER IDENTITY ERASURE (real Postgres).
 *
 * Exercises the REAL erasure service against a real DB:
 *  A) authorization (platform admin vs staff; platform self-delete disallowed; self-only target);
 *  B) membership/ownership (sole-owner block atomic; co-owner allowed; no ownerless tenant; blockers);
 *  C) atomicity/concurrency (converge; rollback on block; concurrent session creation);
 *  D) sessions + platform-privilege removal;
 *  E) historical SET NULL + no surviving PII + opaque no-FK refs;
 *  F) receipt privacy (opaque ids + counts only).
 *
 * Run: pnpm user-deletion:test
 */
import {
  systemDb, createUserSession, readUserSession,
  eraseUserIdentity, eraseUserIdentityAsPlatformAdmin, analyzeUserErasability,
  revokeAllSessionsForUser, getUserDeletionReceipt,
  isUserErasureError, resolvePlatformRole, setPlatformRoleByEmail, isPlatformForbidden,
} from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return pred(e); }
}
const errCode = (e: unknown) => (e as { code?: string })?.code;

async function mkUser(sfx: string, tag: string, name = "U") {
  return systemDb.user.create({ data: { email: `${tag}-${sfx}@example.test`, name } });
}
async function mkTenant(sfx: string, tag: string) {
  return systemDb.tenant.create({ data: { name: `T_${tag}_${sfx}`, slug: `t-${tag}-${sfx}` } });
}
async function member(userId: string, tenantId: string, role: string) {
  return systemDb.membership.create({ data: { userId, tenantId, role: role as never } });
}

async function run() {
  const sfx = Date.now().toString(36);

  // ==================== A) AUTHORIZATION ====================
  const staff = await mkUser(sfx, "staff");
  const padmin = await mkUser(sfx, "padmin");
  const victim = await mkUser(sfx, "victimA");
  await setPlatformRoleByEmail(staff.email, "staff");
  await setPlatformRoleByEmail(padmin.email, "admin");

  check("A6) platform STAFF cannot erase another identity (platform_forbidden)",
    await throws(() => eraseUserIdentityAsPlatformAdmin(staff.id, victim.id), isPlatformForbidden));
  check("A6b) the victim still exists after a denied staff attempt", (await systemDb.user.count({ where: { id: victim.id } })) === 1);
  const padminSelf = await throws(() => eraseUserIdentityAsPlatformAdmin(padmin.id, padmin.id), (e) => isUserErasureError(e) && errCode(e) === "self_delete_not_allowed_via_platform");
  check("A/platform-self) platform admin CANNOT self-delete via the platform path (must use self-service)", padminSelf);
  const platRes = await eraseUserIdentityAsPlatformAdmin(padmin.id, victim.id);
  check("A7) platform ADMIN erases another identity via the SEPARATE user:delete capability",
    !platRes.converged && (await systemDb.user.count({ where: { id: victim.id } })) === 0);
  const platReceipt = await getUserDeletionReceipt(platRes.operationId!);
  check("A7b) platform-admin receipt records initiatedBy=platform_admin + opaque actor id (no PII)",
    platReceipt?.initiatedBy === "platform_admin" && platReceipt?.requestedByUserId === padmin.id && !JSON.stringify(platReceipt).includes("@example.test"));

  // ==================== B) MEMBERSHIP & OWNERSHIP ====================
  // B1 zero-tenant
  const b1 = await mkUser(sfx, "b1");
  check("B1) a user with zero tenants can erase", !(await eraseUserIdentity({ targetUserId: b1.id, actorUserId: b1.id, authority: "self" })).converged);
  // B2/B3 normal member of one / multiple tenants
  const b2 = await mkUser(sfx, "b2"); const tA = await mkTenant(sfx, "A"); const tB = await mkTenant(sfx, "B");
  // tA/tB each need an owner so they don't become ownerless independent of b2
  const ownerA = await mkUser(sfx, "ownerA"); await member(ownerA.id, tA.id, "owner");
  const ownerB = await mkUser(sfx, "ownerB"); await member(ownerB.id, tB.id, "owner");
  await member(b2.id, tA.id, "viewer"); await member(b2.id, tB.id, "analyst");
  check("B3) a normal member of multiple tenants can erase", !(await eraseUserIdentity({ targetUserId: b2.id, actorUserId: b2.id, authority: "self" })).converged);
  check("B11) the unrelated tenants + their owners are untouched",
    (await systemDb.tenant.count({ where: { id: { in: [tA.id, tB.id] } } })) === 2 && (await systemDb.user.count({ where: { id: { in: [ownerA.id, ownerB.id] } } })) === 2);
  // B4 admin (not owner) can erase
  const b4 = await mkUser(sfx, "b4"); const tAd = await mkTenant(sfx, "Ad"); const oAd = await mkUser(sfx, "oAd");
  await member(oAd.id, tAd.id, "owner"); await member(b4.id, tAd.id, "admin");
  check("B4) a tenant Admin (non-owner) can erase", !(await eraseUserIdentity({ targetUserId: b4.id, actorUserId: b4.id, authority: "self" })).converged);
  check("B4b) that tenant keeps its owner", (await systemDb.membership.count({ where: { tenantId: tAd.id, role: "owner" as never } })) === 1);
  // B5 owner-with-coowner
  const b5 = await mkUser(sfx, "b5"); const tCo = await mkTenant(sfx, "Co"); const co = await mkUser(sfx, "co");
  await member(b5.id, tCo.id, "owner"); await member(co.id, tCo.id, "owner");
  check("B5) an Owner with another Owner can erase", !(await eraseUserIdentity({ targetUserId: b5.id, actorUserId: b5.id, authority: "self" })).converged);
  check("B5b/B10) the tenant still has an owner (never ownerless)", (await systemDb.membership.count({ where: { tenantId: tCo.id, role: "owner" as never } })) === 1);
  // B6 sole owner active → blocked
  const b6 = await mkUser(sfx, "b6"); const tSole = await mkTenant(sfx, "Sole"); await member(b6.id, tSole.id, "owner");
  const b6blocked = await throws(() => eraseUserIdentity({ targetUserId: b6.id, actorUserId: b6.id, authority: "self" }), (e) => isUserErasureError(e) && errCode(e) === "sole_owner_blocked");
  check("B6) sole Owner of an ACTIVE tenant is blocked", b6blocked && (await systemDb.user.count({ where: { id: b6.id } })) === 1);
  // B7 sole owner of a deleting tenant → blocked while row exists
  const b7 = await mkUser(sfx, "b7"); const tDel = await mkTenant(sfx, "Del"); await member(b7.id, tDel.id, "owner");
  await systemDb.tenant.update({ where: { id: tDel.id }, data: { deletionState: "deleting", deletionOperationId: `udel-${sfx}` } });
  let b7deletingBlocker = false;
  try { await eraseUserIdentity({ targetUserId: b7.id, actorUserId: b7.id, authority: "self" }); }
  catch (e) { if (isUserErasureError(e) && errCode(e) === "sole_owner_blocked") b7deletingBlocker = (e as { blockers?: Array<{ deletionState: string }> }).blockers?.[0]?.deletionState === "deleting"; }
  check("B7) sole Owner of a DELETING tenant is blocked while the tenant row exists", b7deletingBlocker);
  // B8/B9 multiple sole-owned + mixed
  const b8 = await mkUser(sfx, "b8"); const s1 = await mkTenant(sfx, "s1"); const s2 = await mkTenant(sfx, "s2");
  const safeT = await mkTenant(sfx, "safe"); const safeCo = await mkUser(sfx, "safeCo");
  await member(b8.id, s1.id, "owner"); await member(b8.id, s2.id, "owner");
  await member(b8.id, safeT.id, "owner"); await member(safeCo.id, safeT.id, "owner"); // safeT has a co-owner
  const report = await analyzeUserErasability(b8.id);
  check("B8) multiple sole-owned tenants are ALL returned as blockers", report.blockers.length === 2 && report.blockers.every((x) => [s1.id, s2.id].includes(x.tenantId)));
  check("B9) mixed memberships block if ANY tenant is unsafe (safe co-owned one excluded)", !report.erasable && !report.blockers.some((x) => x.tenantId === safeT.id));

  // ==================== C) ATOMICITY & CONCURRENCY ====================
  // C1 two concurrent self-deletes converge
  const c1 = await mkUser(sfx, "c1");
  const [r1, r2] = await Promise.all([
    eraseUserIdentity({ targetUserId: c1.id, actorUserId: c1.id, authority: "self" }),
    eraseUserIdentity({ targetUserId: c1.id, actorUserId: c1.id, authority: "self" }),
  ]);
  check("C1) two concurrent self-deletes converge (exactly one real delete, both return an op)",
    (r1.converged !== r2.converged) && (await systemDb.user.count({ where: { id: c1.id } })) === 0 &&
    (await systemDb.userDeletionReceipt.count({ where: { deletedUserId: c1.id } })) === 1);
  // C8 rollback on block: nothing deleted (user + sessions + membership + NO receipt)
  const c8 = await mkUser(sfx, "c8"); const tc8 = await mkTenant(sfx, "c8"); await member(c8.id, tc8.id, "owner");
  const c8sess = await createUserSession({ userId: c8.id, activeTenantId: tc8.id });
  await throws(() => eraseUserIdentity({ targetUserId: c8.id, actorUserId: c8.id, authority: "self" }), () => true);
  check("C8) a blocked erase rolls back ENTIRELY (user, session, membership intact; NO receipt)",
    (await systemDb.user.count({ where: { id: c8.id } })) === 1 &&
    (await readUserSession(c8sess.token)).ok === true &&
    (await systemDb.membership.count({ where: { userId: c8.id } })) === 1 &&
    (await systemDb.userDeletionReceipt.count({ where: { deletedUserId: c8.id } })) === 0);
  // C3/C4 concurrent session creation cannot survive; creating after delete throws
  const c3 = await mkUser(sfx, "c3"); const tc3 = await mkTenant(sfx, "c3"); await member(c3.id, tc3.id, "viewer");
  await eraseUserIdentity({ targetUserId: c3.id, actorUserId: c3.id, authority: "self" });
  check("C3) creating a session for a just-erased user fails (no surviving session)",
    (await throws(() => createUserSession({ userId: c3.id, activeTenantId: tc3.id }), () => true)) &&
    (await systemDb.userSession.count({ where: { userId: c3.id } })) === 0);

  // C2-DUAL — MANDATORY: a tenant with EXACTLY two owners; both self-delete concurrently. Exactly one
  // may commit; the other must be BLOCKED (sole owner after the first commits). NEVER zero owners,
  // NEVER a deadlock. Repeated a few times because it is a lock-ordering race.
  let dualClean = 0, dualOwnerless = 0, dualDeadlock = 0;
  for (let i = 0; i < 6; i++) {
    const t = await mkTenant(`${sfx}d${i}`, "dual");
    const A = await mkUser(`${sfx}d${i}`, "dualA"); const B = await mkUser(`${sfx}d${i}`, "dualB");
    await member(A.id, t.id, "owner"); await member(B.id, t.id, "owner");
    const res = await Promise.allSettled([
      eraseUserIdentity({ targetUserId: A.id, actorUserId: A.id, authority: "self" }),
      eraseUserIdentity({ targetUserId: B.id, actorUserId: B.id, authority: "self" }),
    ]);
    const owners = await systemDb.membership.count({ where: { tenantId: t.id, role: "owner" as never } });
    const committed = res.filter((r) => r.status === "fulfilled" && !(r.value as { converged: boolean }).converged).length;
    const blocked = res.filter((r) => r.status === "rejected" && isUserErasureError((r as PromiseRejectedResult).reason) && errCode((r as PromiseRejectedResult).reason) === "sole_owner_blocked").length;
    const deadlock = res.some((r) => r.status === "rejected" && /deadlock|40P01|serialize/i.test(String((r as PromiseRejectedResult).reason?.message ?? "")));
    if (owners === 0) dualOwnerless++;
    if (deadlock) dualDeadlock++;
    else if (committed === 1 && blocked === 1 && owners === 1) dualClean++;
  }
  check("C2-DUAL) two last-Owners self-deleting concurrently → exactly one commits, one blocked, one owner remains",
    dualClean === 6, `clean=${dualClean} ownerless=${dualOwnerless} deadlock=${dualDeadlock}`);
  check("C2-DUAL-safety) NEVER zero owners and NEVER a deadlock across all rounds", dualOwnerless === 0 && dualDeadlock === 0);

  // C-RETRY — lost-response retry: re-erasing an already-gone user CONVERGES on the existing receipt
  // (same operationId), never a second receipt / fabricated new deletion.
  const cr = await mkUser(sfx, "cr");
  const crFirst = await eraseUserIdentity({ targetUserId: cr.id, actorUserId: cr.id, authority: "self" });
  const crRetry = await eraseUserIdentity({ targetUserId: cr.id, actorUserId: cr.id, authority: "self" });
  check("C-RETRY) a retry after commit converges on the SAME receipt (no second receipt)",
    crRetry.converged === true && crRetry.operationId === crFirst.operationId &&
    (await systemDb.userDeletionReceipt.count({ where: { deletedUserId: cr.id } })) === 1);

  // C-NONEXISTENT — a request against a never-existing user does NOT fabricate a receipt/success.
  const nonId = `no-such-user-${sfx}`;
  const nonRes = await eraseUserIdentity({ targetUserId: nonId, actorUserId: nonId, authority: "self" });
  check("C-NONEXISTENT) erasing a never-existing user converges with NO receipt (no fabricated success)",
    nonRes.converged === true && nonRes.operationId === null && (await systemDb.userDeletionReceipt.count({ where: { deletedUserId: nonId } })) === 0);

  // ==================== D) SESSIONS & PLATFORM PRIVILEGE ====================
  const d1 = await mkUser(sfx, "d1"); const td = await mkTenant(sfx, "d"); await member(d1.id, td.id, "owner");
  const co2 = await mkUser(sfx, "co2"); await member(co2.id, td.id, "owner"); // co-owner so d1 is erasable
  await setPlatformRoleByEmail(d1.email, "admin");
  const dSess = await createUserSession({ userId: d1.id, activeTenantId: td.id });
  const revoked = await revokeAllSessionsForUser(d1.id);
  check("D0) revokeAllSessionsForUser revokes the live session (reusable primitive)", revoked >= 1 && (await readUserSession(dSess.token)).ok === false);
  check("D5-pre) platformRole resolves to admin before erase", (await resolvePlatformRole(d1.id)) === "admin");
  await eraseUserIdentity({ targetUserId: d1.id, actorUserId: d1.id, authority: "self" });
  check("D1) all sessions removed after erase", (await systemDb.userSession.count({ where: { userId: d1.id } })) === 0);
  check("D3) a deleted identity cannot hydrate (stale cookie denied)", (await readUserSession(dSess.token)).ok === false);
  check("D5) platformRole is removed with the user (resolves to none)", (await resolvePlatformRole(d1.id)) === "none");
  check("D7) bootstrap lookup by the deleted email returns not_found",
    (await setPlatformRoleByEmail(d1.email, "admin")).ok === false);

  // ==================== E) HISTORICAL REFERENCES (SET NULL) ====================
  const e1 = await mkUser(sfx, "e1"); const te = await mkTenant(sfx, "e"); await member(e1.id, te.id, "viewer");
  const brand = await systemDb.brand.create({ data: { tenantId: te.id, name: "EB" } });
  const acct = await systemDb.connectedAccount.create({ data: { tenantId: te.id, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `EPG_${sfx}`, pageId: `EPG_${sfx}` } });
  const content = await systemDb.contentItem.create({ data: { tenantId: te.id, brandId: brand.id, connectedAccountId: acct.id, platform: "facebook_page", kind: "comment", externalId: `EC_${sfx}`, text: "x", publishedAt: new Date() } });
  const rep = await systemDb.reputationItem.create({ data: { tenantId: te.id, brandId: brand.id, platform: "facebook_page", contentItemId: content.id, assignedToUserId: e1.id } });
  const dec = await systemDb.moderationDecision.create({ data: { tenantId: te.id, brandId: brand.id, reputationItemId: rep.id, action: "hide", proposedByKind: "human", proposedByUserId: e1.id, reviewerUserId: e1.id } });
  const note = await systemDb.inboxNote.create({ data: { tenantId: te.id, reputationItemId: rep.id, authorUserId: e1.id, body: "n" } });
  const audit = await systemDb.auditLog.create({ data: { tenantId: te.id, event: "x", actorKind: "human", actorUserId: e1.id } });
  // opaque no-FK ref (createdBy) — should RETAIN the opaque id (documented; non-PII)
  const policy = await systemDb.brandAutoProtectPolicy.create({ data: { tenantId: te.id, brandId: brand.id, category: "spam", createdBy: e1.id } });
  await eraseUserIdentity({ targetUserId: e1.id, actorUserId: e1.id, authority: "self" });
  check("E1) AuditLog.actorUserId → NULL", (await systemDb.auditLog.findUnique({ where: { id: audit.id }, select: { actorUserId: true } }))!.actorUserId === null);
  check("E2) moderation proposer + reviewer → NULL, row survives",
    (async () => true)() && (await (async () => { const d = await systemDb.moderationDecision.findUnique({ where: { id: dec.id }, select: { proposedByUserId: true, reviewerUserId: true } }); return !!d && d.proposedByUserId === null && d.reviewerUserId === null; })()));
  check("E3) InboxNote.authorUserId → NULL, note survives", (await systemDb.inboxNote.findUnique({ where: { id: note.id }, select: { authorUserId: true } }))!.authorUserId === null);
  check("E4) ReputationItem.assignedToUserId → NULL, item survives", (await systemDb.reputationItem.findUnique({ where: { id: rep.id }, select: { assignedToUserId: true } }))!.assignedToUserId === null);
  check("E6) no direct User PII survives (email/name gone with the row)", (await systemDb.user.count({ where: { id: e1.id } })) === 0);
  check("E7) opaque no-FK ref (createdBy) RETAINED as an opaque id (documented; non-PII, non-authoritative)",
    (await systemDb.brandAutoProtectPolicy.findUnique({ where: { id: policy.id }, select: { createdBy: true } }))!.createdBy === e1.id);

  // ==================== F) RECEIPT / PRIVACY ====================
  const f1 = await mkUser(sfx, "fUser", "Freddy Secret");
  const tf = await mkTenant(sfx, "fTenant"); await member(f1.id, tf.id, "viewer");
  const fSess = await createUserSession({ userId: f1.id, activeTenantId: tf.id });
  const fRes = await eraseUserIdentity({ targetUserId: f1.id, actorUserId: f1.id, authority: "self" });
  const receipt = await getUserDeletionReceipt(fRes.operationId!);
  check("F1) exactly one receipt for the operation", (await systemDb.userDeletionReceipt.count({ where: { operationId: fRes.operationId! } })) === 1);
  check("F2) the receipt SURVIVES the user delete (no FK)", receipt !== null && receipt!.deletedUserId === f1.id);
  const blob = JSON.stringify(receipt);
  const forbidden = [f1.email, "Freddy Secret", `T_fTenant_${sfx}`, fSess.token, "@example.test"];
  const leaks = forbidden.filter((s) => blob.includes(s));
  check("F3-9) receipt has NO email/name/tenant-name/token/session-hash/content/raw-error", leaks.length === 0, `leaked: ${leaks.join(",")}`);
  check("F10) receipt stores only opaque ids + counts + timestamps + bounded enum",
    typeof receipt!.deletedUserId === "string" && ["self", "platform_admin"].includes(receipt!.initiatedBy) &&
    typeof receipt!.membershipCount === "number" && receipt!.membershipCount >= 1 && typeof receipt!.sessionCount === "number");

  console.log(`\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
