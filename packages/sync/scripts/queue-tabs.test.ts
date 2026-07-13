/**
 * V1.27G — Action Queue tabs. The default "active" queue is actionable work only:
 * approval_required + retryable failed. Resolved/monitored/dry-run/handled items are
 * NOT active work. History (all) still shows everything. No demo/mock data.
 *
 * Run via: pnpm queue-tabs:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { queueTabStates, normalizeQueueTab, QUEUE_TABS } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const active = queueTabStates("active")!;
  const has = (s: string) => active.includes(s as never);

  // 1) active includes only actionable states.
  check("1) active includes approval_required + failed", has("approval_required") && has("failed"));
  // 2) active EXCLUDES resolved/monitored/shadow/handled states.
  for (const s of ["approved", "executed", "no_action", "monitor", "dry_run", "suggested", "rejected"]) {
    check(`2) active excludes ${s}`, !has(s));
  }
  // 3) resolved bucket holds terminal states.
  const resolved = queueTabStates("resolved")!;
  check("3) resolved includes executed + no_action + approved", resolved.includes("executed" as never) && resolved.includes("no_action" as never) && resolved.includes("approved" as never));
  check("3b) resolved excludes approval_required", !resolved.includes("approval_required" as never));
  // 4) approval bucket = approval_required only.
  check("4) approval bucket = approval_required only", JSON.stringify(queueTabStates("approval")) === JSON.stringify(["approval_required"]));
  // 5) all → null (no filter = history).
  check("5) all tab → null (history, no filter)", queueTabStates("all") === null);
  // 6) default tab is active; unknown falls back to active.
  check("6) default tab = active", normalizeQueueTab(undefined) === "active" && normalizeQueueTab("nonsense") === "active" && normalizeQueueTab("resolved") === "resolved");
  check("6b) QUEUE_TABS order", JSON.stringify(QUEUE_TABS) === JSON.stringify(["active", "approval", "blocked", "resolved", "all"]));

  // --- Functional: a real query filtered by the active tab excludes resolved items. ---
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (tenant) {
    const T = tenant.id;
    const brand = await prisma.brand.create({ data: { tenantId: T, name: "Queue Tabs Test Brand" } });
    const acct = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `QT_${brand.id}`, pageId: `QT_${brand.id}` } });
    // V1.37.5 — queue items reference a REAL ReputationItem (aqi.itemId composite FK).
    const mk = async (state: string) => {
      const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: brand.id, connectedAccountId: acct.id, platform: "facebook_page", kind: "comment", externalId: `qt_${state}`, text: "x", publishedAt: new Date() } });
      const ri = await prisma.reputationItem.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", contentItemId: ci.id, riskLevel: "high", riskCategories: [], sentiment: "neutral" } });
      return prisma.actionQueueItem.create({ data: { tenantId: T, brandId: brand.id, itemId: ri.id, category: "scam", confidence: 0.9, proposedAction: "hide_comment", queueState: state } });
    };
    try {
      await Promise.all(["approval_required", "executed", "no_action", "monitor", "dry_run", "approved", "failed"].map(mk));
      const activeRows = await prisma.actionQueueItem.findMany({ where: { brandId: brand.id, queueState: { in: active } }, select: { queueState: true } });
      const activeStates = activeRows.map((r) => r.queueState).sort();
      check("7) active query returns only approval_required + failed", JSON.stringify(activeStates) === JSON.stringify(["approval_required", "failed"]), activeStates.join(","));
      const allRows = await prisma.actionQueueItem.count({ where: { brandId: brand.id } });
      check("8) history (all) still shows every record", allRows === 7, String(allRows));
      const resolvedRows = await prisma.actionQueueItem.findMany({ where: { brandId: brand.id, queueState: { in: resolved } }, select: { queueState: true } });
      check("9) executed + no_action appear in Resolved, not Active", resolvedRows.some((r) => r.queueState === "executed") && resolvedRows.some((r) => r.queueState === "no_action"));
      check("10) monitored items never appear in Active", !activeStates.includes("monitor"));
    } finally {
      await prisma.actionQueueItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.brand.deleteMany({ where: { id: brand.id } });
    }
  }

  // Source: the list page defaults to active and offers tabs.
  const pageSrc = readSrc("apps/web/src/app/dashboard/action-queue/page.tsx");
  check("UI) list page filters by tab (default active) with tabs + active copy", pageSrc.includes("normalizeQueueTab") && pageSrc.includes("queueTabStates") && pageSrc.includes("QUEUE_TABS") && pageSrc.includes("queueEmptyActive"));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Action Queue tabs`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
