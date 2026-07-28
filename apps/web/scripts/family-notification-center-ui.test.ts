/**
 * FAMILY NOTIFICATION CENTER V1 — UI view-model + source-invariant tests (no browser). Unit-tests the pure view
 * model / cursor / badge, and statically proves the route/actions/center/bell are session-authoritative, use ONLY
 * the verified Family services, expose no ids/raw metadata/dangerous HTML, and honour the CTA allow-list + i18n
 * parity. Run: pnpm family-notification-center-ui:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAMILY_NOTIFICATION_TYPES } from "@guardora/core";
import type { FamilyNotificationView } from "@guardora/db";
import { familyNotificationCardVM, familyUnreadBadge, IMPLEMENTED_FAMILY_CTA_ROUTES } from "../src/app/family/family-notification-view";
import { familyNotifDict } from "../src/app/family/family-notifications-i18n";
import { decodeFamilyNotificationCursor, encodeFamilyNotificationCursor, normalizeFamilyNotificationView } from "../src/app/family/family-notification-cursor";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");
const dict = familyNotifDict("en");
const row = (over: Partial<FamilyNotificationView>): FamilyNotificationView => ({ id: "n1", type: "family_signal_available", severity: "warning", titleKey: "k", messageKey: "k", createdAt: new Date("2026-01-01T00:00:00Z"), read: false, entityType: "signal", safeRoute: "/family/signals", profileId: "p1", unavailable: false, ...over });

function main() {
  const NOTIF = "src/app/family/(console)/notifications";
  const routeSrc = read(`${NOTIF}/page.tsx`);
  const actionsSrc = read(`${NOTIF}/actions.ts`);
  const centerSrc = read(`${NOTIF}/notification-center.tsx`);
  const bellSrc = read("src/app/family/family-notification-bell.tsx");
  const vmSrc = read("src/app/family/family-notification-view.ts");
  const layoutSrc = read("src/app/family/(console)/layout.tsx");
  const i18nSrc = read("src/app/family/family-notifications-i18n.ts");

  // ═════════ VIEW MODEL ═════════
  console.log("\nVIEW MODEL");
  check("★ (9) all 13 types produce a safe localized card", FAMILY_NOTIFICATION_TYPES.every((t) => { const vm = familyNotificationCardVM(row({ type: t }), dict); return !vm.unavailable && vm.title.length > 2 && vm.message.length > 2 && vm.title !== t; }));
  check("★ (10) an unknown/malformed row → safe fallback (no crash, generic title)", (() => { const vm = familyNotificationCardVM(row({ type: "not_a_type" as never, unavailable: true }), dict); return vm.unavailable && vm.title === dict.center.unavailable && vm.ctaHref === null && vm.dismissible === false; })());
  check("★ (11) severity label + tone derived from the catalogue (never row.severity)", familyNotificationCardVM(row({ type: "family_urgent_signal", severity: "info" }), dict).severity === "urgent" && familyNotificationCardVM(row({ type: "family_delivery_acknowledged" }), dict).severity === "info");
  check("★ (12) read/unread is a boolean, rendered as text (no colour-only)", familyNotificationCardVM(row({ read: true }), dict).read === true && /tabUnread|Unread/.test(centerSrc) && /!n\.read/.test(centerSrc));
  check("★ (13)(14) dismissibility from the catalogue; urgent (non-dismissible) has no dismiss", familyNotificationCardVM(row({ type: "family_delivery_acknowledged" }), dict).dismissible === true && familyNotificationCardVM(row({ type: "family_urgent_signal" }), dict).dismissible === false && familyNotificationCardVM(row({ type: "family_incident_created" }), dict).dismissible === false);
  check("★ (15) never renders a raw type/enum (VM has no `type` field)", !("type" in familyNotificationCardVM(row({}), dict)));
  check("★ (16) never renders a raw reason code (VM has no reason/safeReasonCode field)", !Object.keys(familyNotificationCardVM(row({}), dict)).some((k) => /reason/i.test(k)));
  check("★ (17) 99+ badge rule", familyUnreadBadge(0).show === false && familyUnreadBadge(1).text === "1" && familyUnreadBadge(99).text === "99" && familyUnreadBadge(100).text === "99+" && familyUnreadBadge(1000).text === "99+");
  check("★ (18) CTA is an allow-listed internal route, never an arbitrary metadata href", (() => { const vm = familyNotificationCardVM(row({ type: "family_signal_available", safeRoute: "https://evil.example/family" as never }), dict); return vm.ctaHref === "/family/signals" && IMPLEMENTED_FAMILY_CTA_ROUTES.has(vm.ctaHref!); })());
  check("★ (VM privacy) card exposes no id/tenant/profile/source field beyond the notification id", Object.keys(familyNotificationCardVM(row({}), dict)).every((k) => !/tenant|profile|dedupe|recipient|membership|incident|signalId|deliveryId|invitationId|consent|planId|outbox|metadata|entityType/i.test(k)));

  // Cursor
  console.log("\nCURSOR");
  const cur = encodeFamilyNotificationCursor(new Date("2026-05-05T05:05:05Z"), "abc123");
  check("★ (8) valid cursor round-trips; invalid/forged → null (safe)", decodeFamilyNotificationCursor(cur)?.beforeId === "abc123" && decodeFamilyNotificationCursor("garbage!!") === null && decodeFamilyNotificationCursor("") === null && decodeFamilyNotificationCursor(undefined) === null);
  check("★ (7) unknown filter safely normalizes to all/unread", normalizeFamilyNotificationView("weird") === "all" && normalizeFamilyNotificationView("unread") === "unread" && normalizeFamilyNotificationView(undefined) === "all");

  // ═════════ ROUTE ═════════
  console.log("\nROUTE");
  check("★ (1) route exists (page.tsx)", routeSrc.length > 0);
  check("★ (2)(3) auth + Family workspace required (requireFamilyConsole)", /requireFamilyConsole\(\)/.test(routeSrc));
  check("★ (4) tenant/user come from the session actor (never the client)", /const \{ actor \} = await requireFamilyConsole/.test(routeSrc) && /listFamilyNotifications\(actor/.test(routeSrc) && /familyUnreadNotificationCount\(actor/.test(routeSrc));
  check("★ (5) no tenantId/userId read from the URL", !/searchParams[^]*tenantId|searchParams[^]*userId|sp\.tenantId|sp\.userId/.test(routeSrc));
  check("★ (6) only view/cursor query params are read", /sp\.view/.test(routeSrc) && /sp\.cursor/.test(routeSrc) && !/sp\.(?!view|cursor)[a-z]/i.test(routeSrc.replace(/searchParams/g, "")));
  check("★ (route dynamic) force-dynamic + no-index", /dynamic = "force-dynamic"/.test(routeSrc) && /index: false/.test(routeSrc));

  // ═════════ LIST / UI ═════════
  console.log("\nLIST / UI");
  check("★ (19) semantic list (<ul>/<li>)", /<ul[^>]*>/.test(centerSrc) && /<li[^>]*>/.test(centerSrc));
  check("★ (20) exactly one h1 (via PageHeader on the route)", /PageHeader/.test(routeSrc) && !/<h1/.test(centerSrc));
  check("★ (21)(22) accessible filters; selected state not colour-only (aria-current + underline/text)", /role="tablist"/.test(centerSrc) && /aria-current=\{view === key \? "page"/.test(centerSrc) && /underline/.test(centerSrc));
  check("★ (23)(24) empty + no-unread states", /t\.center\.empty\b/.test(centerSrc) && /t\.center\.emptyUnread/.test(centerSrc));
  check("★ (25) load more control", /t\.center\.loadMore/.test(centerSrc) && /fetchMoreFamilyNotificationsAction/.test(centerSrc));
  check("★ (26) mobile-compatible (flex-wrap, single column, no dense table)", /flex-wrap/.test(centerSrc) && !/<table/.test(centerSrc));
  check("★ (27) semantic <time datetime>", /<time dateTime=\{n\.createdAtISO\}/.test(centerSrc));
  check("★ (28) no dangerouslySetInnerHTML", !/dangerouslySetInnerHTML/.test(centerSrc) && !/dangerouslySetInnerHTML/.test(routeSrc));
  check("★ (29) no eval / new Function", !/\beval\(|new Function\(/.test(centerSrc + actionsSrc + vmSrc));
  check("★ (30) error boundary renders no raw error", (() => { const e = read(`${NOTIF}/error.tsx`); return !/error\.message|\.stack|console\.(log|error)\(error/.test(e); })());
  check("★ (a11y) aria-live result region + real disabled + explicit button type", /aria-live="polite"/.test(centerSrc) && /disabled=\{/.test(centerSrc) && /type="button"/.test(centerSrc) && /type="submit"/.test(centerSrc));

  // ═════════ BELL ═════════
  console.log("\nBELL");
  check("★ (31) Family shell bell exists + mounted in the shell", /FamilyNotificationBell/.test(bellSrc) && /FamilyNotificationBell/.test(read("src/app/family/family-shell.tsx")));
  check("★ (32) bell is Family-scoped (rendered only inside the Family console layout)", /familyUnreadNotificationCount\(actor\)/.test(layoutSrc));
  check("★ (33) bell uses the Family unread-count service", /familyUnreadNotificationCount/.test(layoutSrc) && /familyUnreadBadge/.test(layoutSrc));
  check("★ (34)(35) 0 → no badge; 100+ → 99+ (badge helper)", familyUnreadBadge(0).show === false && familyUnreadBadge(150).text === "99+");
  check("★ (36) accessible count label (aria-label)", /aria-label=\{bell\.ariaLabel\}/.test(bellSrc));
  check("★ (37) count failure is safe (layout try/catch → no-badge fallback)", /try \{[^]*familyUnreadNotificationCount[^]*\} catch/.test(layoutSrc) && /showBadge: false/.test(layoutSrc));
  check("★ (38) no polling/websocket/SSE in the bell or center", !/setInterval|WebSocket|EventSource|new EventSource/.test(bellSrc + centerSrc));
  check("★ (39) bell links to the center", /href="\/family\/notifications"/.test(bellSrc));
  check("★ (40) bell does NOT auto-mark-read", !/markFamilyNotificationRead|markAll/.test(bellSrc));

  // ═════════ ACTIONS ═════════
  console.log("\nACTIONS");
  check("★ (41)(42)(43) actions delegate to the Family services", /markFamilyNotificationRead\(actor/.test(actionsSrc) && /markAllFamilyNotificationsRead\(actor/.test(actionsSrc) && /dismissFamilyNotification\(actor/.test(actionsSrc));
  check("★ (44) NO direct Notification mutation in the web layer", !/\.notification\.(update|create|delete|updateMany)/.test(actionsSrc + centerSrc + routeSrc));
  check("★ (45) session derives tenant/user (requireFamilyActor in every action)", (actionsSrc.match(/requireFamilyActor\(\)/g) ?? []).length >= 4);
  check("★ (46) the client cannot choose type/severity/dismissibility (only notificationId submitted)", /String\(fd\.get\("notificationId"\)/.test(actionsSrc) && !/fd\.get\("(type|severity|dismissible)"\)/.test(actionsSrc));
  check("★ (47) bounded action results (no raw error/id returned)", /CenterActionState/.test(actionsSrc) && /status: "error"/.test(actionsSrc) && !/error\.message|\.stack/.test(actionsSrc));
  check("★ (48) center + bell revalidation (revalidatePath)", /revalidatePath\(CENTER\)/.test(actionsSrc) && /router\.refresh\(\)/.test(centerSrc));
  check("★ (49) explicit button types on every control", /type="button"/.test(centerSrc) && !/<button(?![^>]*type=)/.test(centerSrc));
  check("★ (50) aria-live announces the result", /setAnnounce/.test(centerSrc) && /aria-live="polite"/.test(centerSrc));

  // ═════════ CTA ═════════
  console.log("\nCTA");
  check("★ (51)(52) client submits ONLY notificationId; never a destination URL", /fd\.set\("notificationId", n\.id\)/.test(centerSrc) && !/fd\.set\("(url|href|route|destination)"/.test(centerSrc));
  check("★ (53) strict route allow-list", /IMPLEMENTED_FAMILY_CTA_ROUTES/.test(vmSrc) && /IMPLEMENTED_FAMILY_CTA_ROUTES\.has\(route\)/.test(actionsSrc));
  check("★ (54) external/dangerous schemes rejected (server derives + allow-lists an internal route)", (() => { const vm = familyNotificationCardVM(row({ type: "family_signal_available", safeRoute: "javascript:alert(1)" as never }), dict); return vm.ctaHref !== null && vm.ctaHref.startsWith("/family/"); })());
  check("★ (55) missing/unavailable route falls back safely (open action redirects to center on failure)", /redirect\(`\$\{CENTER\}\?e=open`\)/.test(actionsSrc));
  check("★ (56) current access rechecked server-side (loadFamilyNotificationTypeForOpen own-recipient)", /loadFamilyNotificationTypeForOpen\(actor, id\)/.test(actionsSrc) && /familyNotificationCta\(loaded\.type\)/.test(actionsSrc));
  check("★ (57)(58) no incident/plan detail id in any CTA (only 4 base list routes; no dead links)", [...IMPLEMENTED_FAMILY_CTA_ROUTES].every((r) => /^\/family\/[a-z]+$/.test(r)) && IMPLEMENTED_FAMILY_CTA_ROUTES.size === 4);

  // ═════════ I18N ═════════
  console.log("\nI18N");
  const dictSK = familyNotifDict("sk"), dictDE = familyNotifDict("de");
  const centerKeys = (d: typeof dict) => Object.keys(d.center).sort().join(",");
  check("★ (59) SK/EN/DE center-key parity", centerKeys(dict) === centerKeys(dictSK) && centerKeys(dict) === centerKeys(dictDE));
  check("★ (60) center/bell/action strings present in all locales", [dict, dictSK, dictDE].every((d) => !!d.center.open && !!d.center.loadMore && !!d.center.markAllRead && !!d.center.dismiss && !!d.bell.open && !!d.severity.urgent));
  check("★ (61) unknown fallback string present", [dict, dictSK, dictDE].every((d) => !!d.center.unavailable));
  check("★ (62)(63) copy is content-free (no name/email/age/{{}}/id interpolation placeholders)", !/\{\{|\$\{[^}]*(name|email|age|id|profile|child)/i.test(i18nSrc) && !/%s|%d|:name|:email/.test(i18nSrc));

  // ═════════ SECURITY / SOURCE ═════════
  console.log("\nSECURITY / SOURCE");
  const uiFiles = [routeSrc, actionsSrc, centerSrc, bellSrc, vmSrc, layoutSrc, read("src/app/family/family-notification-cursor.ts")].join("\n");
  check("★ (20.x) no systemDb / internal resolver / outbox / scheduler / expiry imported into the UI", !/systemDb|resolveFamilyNotificationRecipientsTx|family-notification-outbox|family-notification-scheduler|family-notification-expiry|internal\//.test(uiFiles));
  check("★ (20.y) no raw metadata serialization / arbitrary href / external href", !/JSON\.stringify\(.*metadata|\.metadata\b/.test(uiFiles) && !/https?:\/\//.test(centerSrc));
  check("★ (25.x) uses ONLY the verified Family services (list/count/mark/dismiss/open-load)", /listFamilyNotifications|familyUnreadNotificationCount/.test(routeSrc) && !/prisma|PrismaClient/.test(uiFiles));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notification center UI: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
