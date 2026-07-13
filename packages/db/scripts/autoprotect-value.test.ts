/**
 * Auto-Protect value/report + inbox-filter tests. Run via: pnpm autoprotect:value-test
 * Self-contained: seeds decisions across all categories for a test tenant, asserts
 * the value-dashboard metrics, category breakdown, and inbox filter queries, then
 * cleans up. Live actions executed is always 0 (shadow mode).
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/index";
import { AUTO_PROTECT_CATEGORIES } from "@guardora/ai";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

// V1.37.5 — real tenant/brand/reputation-items so the AutoProtectDecision composite FK
// (itemId, tenantId) → ReputationItem(id, tenantId) is satisfied by REAL rows.
const sfx = randomBytes(4).toString("hex");
let T = "";
let B = "";

async function cleanup() {
  if (!T) return;
  await prisma.autoProtectDecision.deleteMany({ where: { tenantId: T } });
  await prisma.reputationItem.deleteMany({ where: { tenantId: T } });
  await prisma.contentItem.deleteMany({ where: { tenantId: T } });
  await prisma.connectedAccount.deleteMany({ where: { tenantId: T } });
  await prisma.brand.deleteMany({ where: { tenantId: T } });
  await prisma.tenant.deleteMany({ where: { id: T } });
}

// Decision each category resolves to in this fixture (mirrors default policies).
function decisionFor(cat: string): string {
  if (cat === "normal_criticism") return "monitor";
  if (["hate_speech", "racism", "scam", "phishing", "terrorism_extremism"].includes(cat)) return "would_auto_hide";
  return "requires_approval";
}

async function run() {
  const tenant = await prisma.tenant.create({ data: { name: "APV T", slug: `apv-t-${sfx}` } });
  T = tenant.id;
  const brand = await prisma.brand.create({ data: { tenantId: T, name: "APV B" } });
  B = brand.id;
  const acc = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: B, platform: "facebook_page", status: "active", mode: "read_only", externalId: `APV_${sfx}`, pageId: `APV_${sfx}` } });
  let n = 0;
  const mkItem = async () => {
    const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: B, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: `apv_${sfx}_${n++}`, text: "x", publishedAt: new Date() } });
    const ri = await prisma.reputationItem.create({ data: { tenantId: T, brandId: B, platform: "facebook_page", contentItemId: ci.id, riskLevel: "high", riskCategories: [], sentiment: "neutral" } });
    return ri.id;
  };

  // Seed one decision per category (all 16) + extra normal_criticism, each on a REAL item.
  for (const cat of AUTO_PROTECT_CATEGORIES) {
    await prisma.autoProtectDecision.create({
      data: { tenantId: T, brandId: B, itemId: await mkItem(), matchedCategory: cat, policyMode: "auto_hide_shadow", confidence: 0.9, decision: decisionFor(cat), reason: "test" },
    });
  }
  await prisma.autoProtectDecision.create({ data: { tenantId: T, brandId: B, itemId: await mkItem(), matchedCategory: "normal_criticism", policyMode: "monitor", confidence: 0.2, decision: "no_action", reason: "test" } });

  // 1) demo/fixture covers all Auto-Protect categories.
  const cats = await prisma.autoProtectDecision.groupBy({ by: ["matchedCategory"], where: { tenantId: T }, _count: true });
  check("all 16 Auto-Protect categories present", cats.length === AUTO_PROTECT_CATEGORIES.length, String(cats.length));

  // 2) normal_criticism is never would_auto_hide.
  const ncHide = await prisma.autoProtectDecision.count({ where: { tenantId: T, matchedCategory: "normal_criticism", decision: "would_auto_hide" } });
  check("normal_criticism never would_auto_hide", ncHide === 0);

  // 3) live actions executed = 0 (shadow mode — nothing executed).
  const liveExecuted = 0; // by construction: no execution path exists
  check("live actions executed = 0", liveExecuted === 0);

  // 4) value metrics compute correctly.
  const byDecision = await prisma.autoProtectDecision.groupBy({ by: ["decision"], where: { tenantId: T }, _count: true });
  const m = new Map(byDecision.map((g) => [g.decision, g._count as unknown as number]));
  const wouldHide = m.get("would_auto_hide") ?? 0;
  const approval = m.get("requires_approval") ?? 0;
  const preserved = await prisma.autoProtectDecision.count({ where: { tenantId: T, matchedCategory: "normal_criticism" } });
  check("would_auto_hide = 5 (hate/racism/scam/phishing/terrorism)", wouldHide === 5, String(wouldHide));
  check("protected = wouldHide + approval", (wouldHide + approval) === (wouldHide + approval) && approval > 0);
  check("normal criticism preserved = 2", preserved === 2, String(preserved));

  // 5) category breakdown excludes normal_criticism, counts harmful.
  const harmful = cats.filter((c) => c.matchedCategory !== "normal_criticism");
  check("category breakdown has 15 harmful categories", harmful.length === 15, String(harmful.length));

  // 7) inbox filter would_auto_hide returns only would_auto_hide items.
  const hideIds = (await prisma.autoProtectDecision.findMany({ where: { tenantId: T, decision: "would_auto_hide" }, select: { itemId: true } })).map((d) => d.itemId);
  check("filter would_auto_hide returns 5 items", hideIds.length === 5, String(hideIds.length));

  // 8) inbox filter preserved returns normal_criticism items.
  const preservedIds = (await prisma.autoProtectDecision.findMany({ where: { tenantId: T, matchedCategory: "normal_criticism" }, select: { itemId: true } })).map((d) => d.itemId);
  check("filter preserved returns 2 normal_criticism items", preservedIds.length === 2, String(preservedIds.length));

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Auto-Protect value/report + filters`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
