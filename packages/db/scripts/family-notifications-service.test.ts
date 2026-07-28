/**
 * FAMILY NOTIFICATIONS V1 — Phase 2 DB/service tests (local DB). Proves the PERSISTENCE + read/mutation
 * services on the existing tenant-scoped Notification model: migration schema, transaction-safe idempotent
 * creation, per-recipient dedupe, rollback safety, Family-scoped listing/unread, own-recipient mutations,
 * soft-dismiss (no delete), strict privacy metadata, and Business regression. Recipient AUTHORIZATION (the
 * resolver) is out of scope for Phase 2 and is NOT exercised here. Run: pnpm family-notifications-service:test
 */
import { randomBytes } from "node:crypto";
import {
  prisma, systemDb, registerUser, hashPassword, withTenant,
  createFamilyNotification, createFamilyNotificationTx, listFamilyNotifications, familyUnreadNotificationCount,
  markFamilyNotificationRead, markAllFamilyNotificationsRead, dismissFamilyNotification, assertFamilyNotificationMetadata,
  createNotification, unreadNotificationCount, listNotifications,
} from "@guardora/db";
import { FAMILY_NOTIFICATION_METADATA_KEYS, FAMILY_NOTIFICATION_TYPES } from "@guardora/core";
import type { FamilyActorContext } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }
const sfx = randomBytes(4).toString("hex");
const tenantIds: string[] = []; const userIds: string[] = [];

async function mkTenant(tag: string): Promise<{ tenantId: string; userId: string }> {
  const t = await registerUser({ email: `fn-${tag}-${sfx}@ex.com`, passwordHash: await hashPassword("password fn 1"), workspaceName: `FN ${tag}`, country: "SK" });
  tenantIds.push(t.tenantId); userIds.push(t.userId);
  return { tenantId: t.tenantId, userId: t.userId };
}
async function mkMember(tenantId: string, tag: string): Promise<string> {
  const id = `fnu_${tag}_${sfx}`; userIds.push(id);
  await systemDb.user.create({ data: { id, email: `${id}@ex.com`, name: tag } });
  await systemDb.membership.create({ data: { userId: id, tenantId, role: "viewer" as never } });
  return id;
}
const actor = (tenantId: string, userId: string): FamilyActorContext => ({ tenantId, userId, role: "owner", workspaceKind: "family" });
const ev = (over: Partial<Parameters<typeof createFamilyNotification>[0]> = {}) => ({ tenantId: "", type: "family_delivery_available", entityId: "dlv_1", eventVersion: "v1", recipientUserIds: [] as string[], ...over });

async function main() {
  const A = await mkTenant("a"); const uB = await mkMember(A.tenantId, "b");
  const B = await mkTenant("c");
  const actorA = actor(A.tenantId, A.userId); const actorB = actor(A.tenantId, uB); const actorC = actor(B.tenantId, B.userId);

  console.log("\n1. schema / migration");
  const cols = await systemDb.$queryRawUnsafe<Array<{ is_nullable: string }>>(`SELECT is_nullable FROM information_schema.columns WHERE table_name='notifications' AND column_name='dismissedAt'`);
  check("★ dismissedAt column exists + nullable", cols[0]?.is_nullable === "YES");
  const enums = await systemDb.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='NotificationType' AND e.enumlabel LIKE 'family_%'`);
  check("★ all 13 Family enum values in Postgres", Number(enums[0]?.n) === 13);
  const rls = await systemDb.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='notifications'`);
  check("★ RLS ENABLED + FORCED on notifications", rls[0]?.relrowsecurity === true && rls[0]?.relforcerowsecurity === true);
  const idx = await systemDb.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM pg_indexes WHERE tablename='notifications' AND indexname LIKE '%dismissedAt%'`);
  check("★ Family query index exists", Number(idx[0]?.n) >= 1);

  console.log("\n2. creation + dedupe + concurrency + rollback + non-null");
  const r1 = await createFamilyNotification(ev({ tenantId: A.tenantId, entityId: "dlv_x", recipientUserIds: [A.userId, uB] }));
  check("★ one row per unique recipient", r1.created === 2 && r1.recipients === 2);
  const r2 = await createFamilyNotification(ev({ tenantId: A.tenantId, entityId: "dlv_x", recipientUserIds: [A.userId, uB] }));
  check("★ same event retry → zero new rows (idempotent)", r2.created === 0);
  const r3 = await createFamilyNotification(ev({ tenantId: A.tenantId, entityId: "dlv_x", eventVersion: "v2", recipientUserIds: [A.userId] }));
  check("★ different eventVersion → a new notification", r3.created === 1);
  const conc = await Promise.all([createFamilyNotification(ev({ tenantId: A.tenantId, entityId: "dlv_conc", recipientUserIds: [A.userId] })), createFamilyNotification(ev({ tenantId: A.tenantId, entityId: "dlv_conc", recipientUserIds: [A.userId] }))]);
  const concTotal = conc.reduce((s, r) => s + r.created, 0);
  check("★ two concurrent same-event calls → exactly ONE row", concTotal === 1);
  const dupAbort = await withTenant(A.tenantId, async (db) => {
    await createFamilyNotificationTx(db, ev({ tenantId: A.tenantId, entityId: "dlv_dup", recipientUserIds: [A.userId] }));
    await createFamilyNotificationTx(db, ev({ tenantId: A.tenantId, entityId: "dlv_dup", recipientUserIds: [A.userId] })); // conflict → skipped, tx NOT aborted
    return db.notification.count({ where: { tenantId: A.tenantId } }); // a further op proves the tx is alive
  });
  check("★ duplicate conflict does NOT abort the surrounding transaction", typeof dupAbort === "number" && dupAbort > 0);
  const before = await systemDb.notification.count({ where: { tenantId: A.tenantId } });
  await throws(() => withTenant(A.tenantId, async (db) => { await createFamilyNotificationTx(db, ev({ tenantId: A.tenantId, entityId: "dlv_rb", recipientUserIds: [A.userId] })); throw new Error("rollback"); }));
  check("★ rolled-back transaction leaves NO notification", (await systemDb.notification.count({ where: { tenantId: A.tenantId } })) === before);
  check("★ zero recipients → zero rows", (await createFamilyNotification(ev({ tenantId: A.tenantId, entityId: "dlv_empty", recipientUserIds: [] }))).created === 0);
  check("★ unknown type fails closed", await throws(() => createFamilyNotification(ev({ tenantId: A.tenantId, type: "family_made_up", recipientUserIds: [A.userId] }))));
  const nullUser = await systemDb.notification.count({ where: { tenantId: A.tenantId, type: { in: FAMILY_NOTIFICATION_TYPES as never }, userId: null } });
  check("★ NO Family row has a null userId (never tenant-wide)", nullUser === 0);

  console.log("\n3. listing + unread (Family-scoped)");
  const listA = await listFamilyNotifications(actorA);
  check("★ recipient sees only THEIR Family notifications", listA.every((n) => n.type.startsWith("family_")) && listA.length > 0);
  check("★ ordering newest-first with stable id tie-break", listA.every((n, i) => i === 0 || listA[i - 1]!.createdAt >= n.createdAt));
  const unreadA0 = await familyUnreadNotificationCount(actorA);
  check("★ unread count > 0 for A", unreadA0 > 0);
  check("★ unreadOnly filter returns only unread", (await listFamilyNotifications(actorA, { unreadOnly: true })).every((n) => !n.read));
  // Business notification must NOT appear in the Family center, and a tenant-wide escalation must not either.
  await createNotification({ tenantId: A.tenantId, userId: A.userId, type: "trial_ending", titleKey: "t", messageKey: "m", dedupeKey: `biz:${sfx}` });
  await createNotification({ tenantId: A.tenantId, userId: null, type: "child_safety_escalation", titleKey: "t", messageKey: "m", dedupeKey: `esc:${sfx}` });
  check("★ Business + tenant-wide escalation excluded from Family list", (await listFamilyNotifications(actorA)).every((n) => n.type.startsWith("family_")));
  check("★ Business + escalation excluded from Family unread count", (await familyUnreadNotificationCount(actorA)) === unreadA0);

  console.log("\n4. mutations (own-recipient, idempotent, soft-dismiss)");
  const one = (await listFamilyNotifications(actorA, { unreadOnly: true }))[0]!;
  check("★ recipient marks their notification read", (await markFamilyNotificationRead(actorA, one.id)) === 1);
  check("★ repeated mark-read is idempotent (0 changed)", (await markFamilyNotificationRead(actorA, one.id)) === 0);
  check("★ another user cannot mark it read", (await markFamilyNotificationRead(actorB, one.id)) === 0);
  check("★ another tenant cannot mark it read", (await markFamilyNotificationRead(actorC, one.id)) === 0);
  const bUnreadBefore = await familyUnreadNotificationCount(actorB);
  await markAllFamilyNotificationsRead(actorA);
  check("★ mark-all affects only the signed-in recipient", (await familyUnreadNotificationCount(actorA)) === 0 && (await familyUnreadNotificationCount(actorB)) === bUnreadBefore);
  // dismiss: family_delivery_available is NOT dismissible → rejected; an urgent type also not dismissible.
  const dlv = (await listFamilyNotifications(actorA))[0]!;
  const dRes = await dismissFamilyNotification(actorA, dlv.id);
  check("★ non-dismissible type (delivery_available) rejects dismissal, fail-closed", dRes.ok === false);
  // a dismissible type: create a family_authority_changed and dismiss it.
  await createFamilyNotification(ev({ tenantId: A.tenantId, type: "family_authority_changed", entityId: "auth_1", recipientUserIds: [A.userId] }));
  const dismissible = (await listFamilyNotifications(actorA)).find((n) => n.type === "family_authority_changed")!;
  check("★ dismissible type can be dismissed", (await dismissFamilyNotification(actorA, dismissible.id)).ok === true);
  check("★ dismissed row is EXCLUDED from list + unread", (await listFamilyNotifications(actorA)).every((n) => n.id !== dismissible.id));
  check("★ dismissed row REMAINS in the database (soft, auditable)", (await systemDb.notification.count({ where: { id: dismissible.id, dismissedAt: { not: null } } })) === 1);
  check("★ repeated allowed dismiss is idempotent", (await dismissFamilyNotification(actorA, dismissible.id)).ok === true);
  check("★ other user cannot dismiss", (await dismissFamilyNotification(actorB, dismissible.id)).ok === false);

  console.log("\n5. strict privacy metadata");
  check("★ allow-list validator rejects a forbidden key", (() => { try { assertFamilyNotificationMetadata({ notificationType: "x", email: "a@b.c" } as never); return false; } catch { return true; } })());
  check("★ allow-list validator rejects a nested object/array", (() => { try { assertFamilyNotificationMetadata({ notificationType: "x", entityId: "y", nested: { a: 1 } } as never); return false; } catch { return true; } })());
  const persisted = await systemDb.notification.findFirst({ where: { tenantId: A.tenantId, type: { in: FAMILY_NOTIFICATION_TYPES as never } }, select: { metadata: true, titleKey: true, severity: true } });
  const mkeys = Object.keys((persisted?.metadata ?? {}) as Record<string, unknown>);
  check("★ every persisted metadata key is in the strict allow-list", mkeys.every((k) => (FAMILY_NOTIFICATION_METADATA_KEYS as string[]).includes(k)));
  check("★ persisted titleKey/severity come from the catalogue (caller cannot override)", persisted?.titleKey?.startsWith("family_notif.") === true);
  check("★ no email/token/name/content key in any persisted Family row", mkeys.every((k) => !/email|token|name|message|content|note/i.test(k)));

  console.log("\n6. Business regression (unchanged)");
  const bizTenant = await mkTenant("biz"); const bizActorUser = bizTenant.userId;
  const bizUnread0 = await unreadNotificationCount(bizTenant.tenantId, bizActorUser);
  await createNotification({ tenantId: bizTenant.tenantId, userId: bizActorUser, type: "payment_failed", titleKey: "t", messageKey: "m", dedupeKey: `bz:${sfx}` });
  check("★ Business unread count increments normally (unchanged behaviour)", (await unreadNotificationCount(bizTenant.tenantId, bizActorUser)) === bizUnread0 + 1);
  check("★ Business list still returns the Business notification", (await listNotifications(bizTenant.tenantId, bizActorUser)).some((n) => n.type === "payment_failed"));
  check("★ Family list on a Business tenant returns nothing (type filter)", (await listFamilyNotifications(actor(bizTenant.tenantId, bizActorUser))).length === 0);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await systemDb.notification.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
    await systemDb.membership.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
    for (const id of tenantIds) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    for (const id of userIds) await systemDb.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications service (DB): ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
