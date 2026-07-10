/**
 * V1.28C — Command Center product cockpit. Source + logic assertions that the page
 * answers the five acceptance questions cleanly, hides technical detail behind
 * Advanced, and follows DB state truth. No demo/mock data.
 *
 * Run via: pnpm command-center-product:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { relativeTime } from "../../../apps/web/src/lib/format";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");

  // 1) Protection status block with all four states.
  check("1) shows a protection status block (4 states)", cc.includes("STATUS_META") && ["protectionProtected", "protectionPartial", "protectionAttention", "protectionOff"].every((k) => cc.includes(k)));
  // 2) auto-hidden today.
  check("2) shows auto-hidden today", cc.includes("autoHidesToday") && cc.includes("hiddenToday"));
  // 3) pending approvals.
  check("3) shows awaiting decision (approval_required count)", cc.includes("pendingDecision") && /queueState: "approval_required"/.test(cc));
  // 4) account status summary.
  check("4) shows account status summary", cc.includes("accountStatus") && cc.includes("needsReconnect"));
  // 5) no provider codes by default.
  check("5) no providerResponseCode / providerErrorCode as default UI", !cc.includes("providerResponseCode") && !/providerErrorCode ?\?\? ?"error"/.test(cc));
  // 6) no raw execution rows / table by default.
  check("6) no raw execution table by default", !cc.includes("<table"));
  // 7) empty active queue message.
  check("7) shows 'no items waiting' when attention empty", cc.includes("queueEmptyActive") && cc.includes("attentionItems.length === 0"));
  // 8) reconnect CTA only when needed.
  check("8) reconnect CTA gated on needsReconnect / !ok", /needsReconnect\.length > 0/.test(cc) && /!ok \?[\s\S]*?ctaReconnect/.test(cc));
  // 9) automatic protection ON/OFF card.
  check("9) automatic protection card with on/off/partial", cc.includes("autoState") && cc.includes("t.cc.partiallyOn") && cc.includes("autoOffNote"));
  // 10) technical detail behind Advanced <details>.
  check("10) technical metrics behind Advanced <details>", /<details>[\s\S]*?t\.cc\.advanced/.test(cc) && cc.includes("blockedByCanHide") && cc.includes("hourlyUsage"));
  // 11) mobile: no wide tables; metric grid is 2-col on mobile.
  check("11) mobile-first: grid-cols-2 metric cards, no tables", cc.includes("grid-cols-2") && !cc.includes("<table"));
  // 12) executed autonomous → auto-hidden today (trigger=autonomous filter).
  check("12) auto-hidden today counts trigger=autonomous executed today", /status: "executed", trigger: "autonomous", executedAt: \{ gte: dayStart \}/.test(cc));
  // 13) deleted/unavailable shown as resolved, not token error.
  check("13) deleted comments → resolved summary (not token error)", cc.includes("sumDeleted") && cc.includes("comment_deleted_or_unavailable"));
  // 14) can_hide=false shown as a Facebook limitation.
  check("14) can_hide=false shown as Facebook limitation", cc.includes("sumCanHideFalse") && /reason: "facebook_can_hide_false"/.test(cc));
  // 15) production SK copy present (no dry-run/provider as default label).
  check("15) SK product copy present; no dry-run/provider default labels", sk.includes("Guardora aktuálne chráni") && sk.includes("Skryté dnes") && sk.includes("Dnešná ochrana") && !cc.includes("dry_run"));
  check("15b) EN keys exist", en.includes("protectionProtected") && en.includes("hiddenToday"));

  // Behavioral: relativeTime helper.
  const base = new Date("2026-07-10T18:37:00Z");
  const s = { justNow: "just now", minAgo: "{n} min ago", today: "today {t}" };
  check("R1) relativeTime just now", relativeTime(new Date(base.getTime() - 30_000), s, base) === "just now");
  check("R2) relativeTime minutes", relativeTime(new Date(base.getTime() - 5 * 60_000), s, base) === "5 min ago");
  check("R3) relativeTime same-day", relativeTime(new Date("2026-07-10T09:05:00Z"), s, base) === "today 09:05");

  // No demo/mock data in the DB.
  const [mock, demo] = await Promise.all([
    prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
    prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
  ]);
  check("no demo/mock data", mock === 0 && demo === 0);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Command Center product cockpit`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
