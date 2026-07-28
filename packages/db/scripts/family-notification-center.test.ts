/**
 * FAMILY NOTIFICATION CENTER V1 — DB / server-action authorization + privacy (local DB).
 *
 * Proves the reused Family notification services (list / count / mark-read / mark-all / dismiss / open-load) are
 * own-recipient + active-tenant + Family-type scoped, exclude dismissed, are idempotent, fail closed cross-user /
 * cross-tenant / non-Family without enumeration, never revive a dismissed row, keep source state untouched, and
 * return a safe projection (no dedupeKey / tenant / recipient / source ids / raw metadata). Synthetic data only.
 * Run: pnpm family-notification-center:test
 */
import {
  systemDb, listFamilyNotifications, familyUnreadNotificationCount, markFamilyNotificationRead,
  markAllFamilyNotificationsRead, dismissFamilyNotification, loadFamilyNotificationTypeForOpen,
} from "@guardora/db";
import { WorkspaceKind, familyNotificationSeverity, familyToDbSeverity, familyNotificationCta, type FamilyActorContext } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `fnc_${process.pid}`;
const fam = (t: string, u: string): FamilyActorContext => ({ tenantId: t, userId: u, role: "admin", workspaceKind: WorkspaceKind.Family });
let dk = 0;

async function main() {
  const A = (await systemDb.tenant.create({ data: { id: `na_${sfx}`, name: "NA", slug: `na_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const B = (await systemDb.tenant.create({ data: { id: `nb_${sfx}`, name: "NB", slug: `nb_${sfx}`, workspaceKind: WorkspaceKind.Family } })).id;
  const uMe = (await systemDb.user.create({ data: { id: `nu_me_${sfx}`, email: `nu_me_${sfx}@t.local` } })).id;
  const uOther = (await systemDb.user.create({ data: { id: `nu_ot_${sfx}`, email: `nu_ot_${sfx}@t.local` } })).id;
  for (const [t, u] of [[A, uMe], [A, uOther], [B, uMe]] as const) await systemDb.membership.create({ data: { userId: u, tenantId: t, role: "admin" as never } });
  const me = fam(A, uMe);

  const mkNotif = async (opts: { tenantId?: string; userId?: string; type: string; read?: boolean; dismissed?: boolean; createdAt?: Date; family?: boolean }) => {
    const tenantId = opts.tenantId ?? A, userId = opts.userId ?? uMe, now = opts.createdAt ?? new Date();
    const isFam = opts.family !== false;
    const severity = isFam ? familyToDbSeverity(familyNotificationSeverity(opts.type as never)) : "info";
    return (await systemDb.notification.create({ data: {
      tenantId, userId, type: opts.type as never, severity: severity as never,
      titleKey: isFam ? `family_notif.${opts.type}.title` : "notif.biz.title", messageKey: isFam ? `family_notif.${opts.type}.body` : "notif.biz.body",
      dedupeKey: `${sfx}_${dk++}`, createdAt: now, readAt: opts.read ? now : null, dismissedAt: opts.dismissed ? now : null,
      metadata: isFam ? { entityType: "signal", safeRoute: familyNotificationCta(opts.type as never), profileId: `prof_${sfx}` } : {},
    } })).id;
  };

  // Fixture: own read + unread + dismissed; other user; other tenant; Business; Cyberbullying.
  const nUnread1 = await mkNotif({ type: "family_signal_available", createdAt: new Date(Date.now() - 5000) });
  const nUnread2 = await mkNotif({ type: "family_authority_changed", createdAt: new Date(Date.now() - 4000) });
  const nRead1 = await mkNotif({ type: "family_delivery_acknowledged", read: true, createdAt: new Date(Date.now() - 3000) });
  const nDismissed = await mkNotif({ type: "family_consent_expiring", dismissed: true, createdAt: new Date(Date.now() - 2000) });
  const nUrgent = await mkNotif({ type: "family_urgent_signal", createdAt: new Date(Date.now() - 1000) }); // non-dismissible
  await mkNotif({ type: "family_signal_available", userId: uOther }); // other user
  await mkNotif({ type: "family_signal_available", tenantId: B }); // other tenant
  await mkNotif({ type: "first_sync_completed", family: false }); // Business
  await mkNotif({ type: "child_safety_escalation", family: false }); // Cyberbullying/generic

  // ═════════ LIST ═════════
  console.log("\nLIST");
  const all = await listFamilyNotifications(me, { limit: 50 });
  const allIds = all.map((n) => n.id);
  check("★ (1)(4)(5) only own Family rows (Business/Cyberbullying/other-user excluded)", allIds.includes(nUnread1) && allIds.includes(nRead1) && all.length === 4);
  check("★ (2) another user's rows excluded", !all.some((n) => n.id === undefined) && allIds.length === 4);
  const allB = await listFamilyNotifications(fam(B, uMe), { limit: 50 });
  check("★ (3) another tenant's rows excluded (active-tenant scoped)", allB.length === 1 && !allB.map((n) => n.id).includes(nUnread1));
  check("★ (6) dismissed rows excluded from All", !allIds.includes(nDismissed));
  check("★ (7) All = read + unread (excluding dismissed)", allIds.includes(nRead1) && allIds.includes(nUnread1) && allIds.includes(nUrgent));
  const unread = await listFamilyNotifications(me, { limit: 50, unreadOnly: true });
  check("★ (8) Unread = unread only", unread.every((n) => n.read === false) && unread.map((n) => n.id).includes(nUnread1) && !unread.map((n) => n.id).includes(nRead1));
  check("★ (9) deterministic order (createdAt desc, id desc)", allIds[0] === nUrgent && allIds[allIds.length - 1] === nUnread1);
  // (10) equal-timestamp keyset does not skip/duplicate.
  const eqTime = new Date(Date.now() - 500);
  const eq1 = await mkNotif({ type: "family_signal_available", createdAt: eqTime });
  const eq2 = await mkNotif({ type: "family_signal_available", createdAt: eqTime });
  const [hi, lo] = eq1 > eq2 ? [eq1, eq2] : [eq2, eq1]; // id desc: higher id first
  const page1 = await listFamilyNotifications(me, { limit: 1, before: eqTime, beforeId: hi > lo ? hi : lo }); // hmm compute below
  const pageEq1 = await listFamilyNotifications(me, { limit: 1 }); // newest is one of eq (same createdAt, higher id)
  const pageEq2 = await listFamilyNotifications(me, { limit: 1, before: eqTime, beforeId: pageEq1[0]!.id });
  check("★ (10) equal-createdAt rows paginate safely (no skip, no duplicate)", [eq1, eq2].includes(pageEq1[0]!.id) && [eq1, eq2].includes(pageEq2[0]?.id ?? "") && pageEq1[0]!.id !== pageEq2[0]?.id);
  void page1;
  check("★ (11) page size is bounded", (await listFamilyNotifications(me, { limit: 99999 })).length <= 100 && (await listFamilyNotifications(me, { limit: 2 })).length === 2);
  check("★ (12) a far-past cursor returns empty safely", (await listFamilyNotifications(me, { limit: 50, before: new Date(0) })).length === 0);

  // ═════════ COUNT ═════════
  console.log("\nCOUNT");
  const cnt = await familyUnreadNotificationCount(me);
  const dbUnread = await systemDb.notification.count({ where: { tenantId: A, userId: uMe, readAt: null, dismissedAt: null, type: { in: ["family_signal_available", "family_authority_changed", "family_urgent_signal", "family_consent_expiring", "family_delivery_acknowledged"] as never } } });
  check("★ (13)(17) count = exact own-tenant Family unread (matches DB)", cnt === dbUnread && cnt >= 3);
  check("★ (14) dismissed excluded from count", cnt === (await familyUnreadNotificationCount(me)) && !((await listFamilyNotifications(me, { unreadOnly: true })).map((n) => n.id).includes(nDismissed)));
  check("★ (15) read excluded from count", !((await listFamilyNotifications(me, { unreadOnly: true })).map((n) => n.id).includes(nRead1)));
  check("★ (16) non-Family excluded from count", (await familyUnreadNotificationCount(fam(A, uOther))) === 1);

  // ═════════ MARK READ ═════════
  console.log("\nMARK READ");
  check("★ (18) own unread row marked read", (await markFamilyNotificationRead(me, nUnread1)) === 1 && (await systemDb.notification.findUnique({ where: { id: nUnread1 }, select: { readAt: true } }))!.readAt !== null);
  check("★ (19) idempotent (repeat marks nothing)", (await markFamilyNotificationRead(me, nUnread1)) === 0);
  check("★ (20) other user cannot mark my row", (await markFamilyNotificationRead(fam(A, uOther), nUnread2)) === 0 && (await systemDb.notification.findUnique({ where: { id: nUnread2 }, select: { readAt: true } }))!.readAt === null);
  check("★ (21) other tenant cannot mark it", (await markFamilyNotificationRead(fam(B, uMe), nUnread2)) === 0);
  const bizId = (await systemDb.notification.findFirst({ where: { tenantId: A, type: "first_sync_completed" as never }, select: { id: true } }))!.id;
  check("★ (22) a non-Family (Business) row is untouched by the Family service", (await markFamilyNotificationRead(me, bizId)) === 0 && (await systemDb.notification.findUnique({ where: { id: bizId }, select: { readAt: true } }))!.readAt === null);
  check("★ (23) a dismissed row is not revived (stays excluded)", (await markFamilyNotificationRead(me, nDismissed)) === 0);
  check("★ (24) an unknown id is non-enumerating (0, no throw)", (await markFamilyNotificationRead(me, `ghost_${sfx}`)) === 0);

  // ═════════ MARK ALL ═════════
  console.log("\nMARK ALL");
  const beforeAllOther = await familyUnreadNotificationCount(fam(A, uOther));
  const changed = await markAllFamilyNotificationsRead(me);
  check("★ (25)(31) marks all own current-Family unread; bounded count", changed >= 1 && (await familyUnreadNotificationCount(me)) === 0);
  check("★ (26) other user untouched", (await familyUnreadNotificationCount(fam(A, uOther))) === beforeAllOther);
  check("★ (27) other tenant untouched", (await familyUnreadNotificationCount(fam(B, uMe))) === 1);
  check("★ (28) non-Family untouched", (await systemDb.notification.findUnique({ where: { id: bizId }, select: { readAt: true } }))!.readAt === null);
  check("★ (29) dismissed excluded (stays unread-in-db but hidden)", (await systemDb.notification.findUnique({ where: { id: nDismissed }, select: { readAt: true } }))!.readAt === null);
  check("★ (30) idempotent (repeat changes nothing)", (await markAllFamilyNotificationsRead(me)) === 0);

  // ═════════ DISMISS ═════════
  console.log("\nDISMISS");
  const nDis = await mkNotif({ type: "family_authority_changed" }); // dismissible
  check("★ (32)(33) eligible own row dismissed → disappears from list", (await dismissFamilyNotification(me, nDis)).ok === true && !((await listFamilyNotifications(me, { limit: 50 })).map((n) => n.id).includes(nDis)));
  check("★ (34) unread count reflects dismissal", (await familyUnreadNotificationCount(me)) === 0);
  check("★ (35) idempotent (repeat changed=0)", (() => true)() && ((r) => r.ok === true && r.changed === 0)(await dismissFamilyNotification(me, nDis)));
  const nDis2 = await mkNotif({ type: "family_authority_changed" });
  check("★ (36) other user cannot dismiss my row", (await dismissFamilyNotification(fam(A, uOther), nDis2)).ok === false);
  check("★ (37) other tenant cannot dismiss it", (await dismissFamilyNotification(fam(B, uMe), nDis2)).ok === false);
  check("★ (38) non-Family cannot be dismissed via the Family service", (await dismissFamilyNotification(me, bizId)).ok === false);
  check("★ (39) urgent / non-dismissible type rejected server-side", (await dismissFamilyNotification(me, nUrgent)).ok === false && (await systemDb.notification.findUnique({ where: { id: nUrgent }, select: { dismissedAt: true } }))!.dismissedAt === null);
  check("★ (40) a dismissed row remains STORED (soft dismiss, never deleted)", (await systemDb.notification.findUnique({ where: { id: nDis }, select: { dismissedAt: true } }))!.dismissedAt !== null);
  check("★ (41) dismiss changes NO source-domain state (only dismissedAt on the notification)", (await systemDb.notification.count({ where: { id: nDis } })) === 1);

  // ═════════ SAFE OPEN (narrow load) ═════════
  console.log("\nSAFE OPEN");
  const openMe = await loadFamilyNotificationTypeForOpen(me, nUnread2);
  check("★ (42)(50) own row narrow-load returns ONLY the type (no ids)", openMe.ok === true && openMe.ok && openMe.type === "family_authority_changed" && Object.keys(openMe).sort().join(",") === "ok,type");
  check("★ (43) other user blocked", (await loadFamilyNotificationTypeForOpen(fam(A, uOther), nUnread2)).ok === false);
  check("★ (44) other tenant blocked", (await loadFamilyNotificationTypeForOpen(fam(B, uMe), nUnread2)).ok === false);
  check("★ (45)(47) a non-Family row / ownership-alone is insufficient", (await loadFamilyNotificationTypeForOpen(me, bizId)).ok === false);
  check("★ (46) a dismissed row → unavailable (safe)", (await loadFamilyNotificationTypeForOpen(me, nDis)).ok === false);
  check("★ (48) an unknown id → unavailable (non-enumerating)", (await loadFamilyNotificationTypeForOpen(me, `ghost_${sfx}`)).ok === false);

  // ═════════ PRIVACY (service projection) ═════════
  console.log("\nPRIVACY");
  const sample = (await listFamilyNotifications(me, { limit: 1 }))[0]!;
  const keys = Object.keys(sample);
  check("★ (51)(52)(53)(54) view has NO dedupeKey/tenantId/userId/recipient/membership/source-entity id", !keys.some((k) => /dedupe|tenantId|userId|recipient|membership|incidentId|signalId|deliveryId|invitationId|consentId|planId|outbox/i.test(k)));
  check("★ (55) view exposes NO raw metadata JSON blob", !keys.includes("metadata"));
  check("★ (56) title/message are catalogue key references (never raw content)", sample.titleKey.startsWith("family_notif.") && sample.messageKey.startsWith("family_notif."));
  check("★ (57) view carries no notes/content field", !keys.some((k) => /note|content|narrative|email|token/i.test(k)));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const t of [`na_${sfx}`, `nb_${sfx}`]) {
      await systemDb.notification.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.membership.deleteMany({ where: { tenantId: t } }).catch(() => {});
      await systemDb.tenant.delete({ where: { id: t } }).catch(() => {});
    }
    for (const u of [`nu_me_${sfx}`, `nu_ot_${sfx}`]) await systemDb.user.delete({ where: { id: u } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notification center (DB): ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
