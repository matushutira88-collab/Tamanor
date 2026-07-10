/**
 * V1.28B — dashboard cleanup, navigation, responsive UI.
 * Production nav (5 primary + More), fixed sidebar with independently scrolling
 * content, mobile drawer, no developer/debug panels in the default view, and the
 * active queue as the working queue. Source assertions + DB demo check.
 *
 * Run via: pnpm dashboard-cleanup:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { queueTabStates } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const nav = readSrc("apps/web/src/lib/nav.ts");
  const sidebar = readSrc("apps/web/src/components/dashboard/sidebar.tsx");
  const shell = readSrc("apps/web/src/components/dashboard/dashboard-shell.tsx");
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  const aqList = readSrc("apps/web/src/app/dashboard/action-queue/page.tsx");
  const aqDetail = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");

  // 1/2) Default Action Queue = active working queue (states enforced in @guardora/ai).
  const active = queueTabStates("active")!;
  check("1) default Active excludes executed/no_action/approved/monitor/dry_run", ["executed", "no_action", "approved", "monitor", "dry_run"].every((s) => !active.includes(s as never)));
  check("2) Active includes approval_required (actionable)", active.includes("approval_required" as never));
  check("2b) list page defaults to the active tab", aqList.includes("normalizeQueueTab") && aqList.includes("queueTabStates"));

  // 3/4 are behavioral — covered by queue-tabs:test + auto-hide:test (queue resolution).

  // 5) Command Center does not duplicate the full Action Queue table — it links to it.
  check("5) Command Center has no full queue table (links to Action Queue instead)", !cc.includes("actionQueueItem.findMany") && cc.includes('href="/dashboard/action-queue"'));

  // 6) Sidebar fixed on desktop: full-height sidebar inside a fixed-height shell.
  check("6) sidebar is fixed-height (h-dvh) on desktop", sidebar.includes("h-dvh") && shell.includes("hidden lg:block"));

  // 7) Mobile drawer: hamburger + overlay + tap-outside close, below lg.
  check("7) mobile nav drawer exists (hamburger, overlay, tap-outside close)", shell.includes("lg:hidden") && shell.includes("setOpen(true)") && /onClick=\{\(\) => setOpen\(false\)\}/.test(shell) && shell.includes("-translate-x-full"));

  // 8) Main content scrolls independently (shell fixed height + overflow on content only).
  check("8) main content scrolls independently of the sidebar", /h-dvh overflow-hidden/.test(shell) && /flex-1 overflow-y-auto/.test(shell));

  // 9) No raw debug diagnostics in the DEFAULT Command Center view — technical
  //    metrics live behind <details> Advanced; provider error codes are not primary UI.
  check("9) Command Center technical metrics behind Advanced", cc.includes("<details") && cc.includes("t.cc.advanced"));
  check("9b) provider error code is not primary Command Center UI", !cc.includes("providerErrorCode ?? \"error\""));
  check("9c) Action Queue detail env-gates/expected-result behind Advanced", /<details>[\s\S]*?controlledHideTest/.test(aqDetail));

  // F) Production nav: 5 primary + More; duplicates hidden but routes intact.
  const visibleCount = (nav.match(/href: "\/dashboard/g) ?? []).length - (nav.match(/hidden: true/g) ?? []).length;
  check("F1) nav has 8 visible entries (5 primary + Timeline/Audit/Settings)", visibleCount === 8, String(visibleCount));
  check("F2) duplicates hidden from nav (Approvals/Inbox/Dashboard/Brands/Rules...)", (nav.match(/hidden: true/g) ?? []).length >= 8);
  check("F3) sidebar filters hidden entries", sidebar.includes("filter((n) => !n.hidden)"));

  // G) Copy: no dry-run row as a main Command Center label; hidden-for-public wording exists.
  check("G1) Command Center pending card has no dry_run row", !/queueState", "dry_run"/.test(cc));
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  check("G2) production SK wording present", sk.includes("skrytý pre verejnosť") && sk.includes("Automatická ochrana") && sk.includes("Rozšírené"));

  // 10) No demo/mock data in the production dashboard DB.
  const [mockAccts, demoBrands] = await Promise.all([
    prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
    prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
  ]);
  check("10) no demo/mock data (0 mock accounts, 0 demo brands)", mockAccts === 0 && demoBrands === 0, `${mockAccts}/${demoBrands}`);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Dashboard cleanup`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
