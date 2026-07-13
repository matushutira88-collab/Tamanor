/**
 * DB-level Auto-Protect tests. Run via: pnpm autoprotect:db-test
 * Verifies decision persistence, policy/decision tenant+brand isolation, and that
 * no platform-action state is written. Cleans up after itself.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

// V1.37.5 — real tenant/brand/reputation-item so the composite FK on AutoProtectDecision
// (itemId, tenantId) → ReputationItem(id, tenantId) is satisfied by REAL rows.
const sfx = randomBytes(4).toString("hex");
let T = "";
let BRAND_A = "";
let BRAND_B = "";
let AP_ITEM = "";

async function cleanup() {
  if (!T) return;
  await prisma.autoProtectDecision.deleteMany({ where: { tenantId: T } });
  await prisma.brandAutoProtectPolicy.deleteMany({ where: { tenantId: T } });
  await prisma.reputationItem.deleteMany({ where: { tenantId: T } });
  await prisma.contentItem.deleteMany({ where: { tenantId: T } });
  await prisma.connectedAccount.deleteMany({ where: { tenantId: T } });
  await prisma.brand.deleteMany({ where: { tenantId: T } });
  await prisma.tenant.deleteMany({ where: { id: T } });
}

async function run() {
  const tenant = await prisma.tenant.create({ data: { name: "AP T", slug: `ap-t-${sfx}` } });
  T = tenant.id;
  const brA = await prisma.brand.create({ data: { tenantId: T, name: "AP A" } });
  const brB = await prisma.brand.create({ data: { tenantId: T, name: "AP B" } });
  BRAND_A = brA.id; BRAND_B = brB.id;
  const acc = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: BRAND_A, platform: "facebook_page", status: "active", mode: "read_only", externalId: `AP_${sfx}`, pageId: `AP_${sfx}` } });
  const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: BRAND_A, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: `ap_c_${sfx}`, text: "x", publishedAt: new Date() } });
  const ri = await prisma.reputationItem.create({ data: { tenantId: T, brandId: BRAND_A, platform: "facebook_page", contentItemId: ci.id, riskLevel: "high", riskCategories: ["hate_speech"], sentiment: "neutral" } });
  AP_ITEM = ri.id;

  // Policies for two brands.
  await prisma.brandAutoProtectPolicy.create({ data: { tenantId: T, brandId: BRAND_A, category: "hate_speech", mode: "auto_hide_shadow", minConfidence: 0.7, isActive: true } });
  await prisma.brandAutoProtectPolicy.create({ data: { tenantId: T, brandId: BRAND_B, category: "hate_speech", mode: "monitor", minConfidence: 0.7, isActive: true } });

  // 11) decision persists (itemId now references a REAL ReputationItem).
  await prisma.autoProtectDecision.create({ data: { tenantId: T, brandId: BRAND_A, itemId: AP_ITEM, matchedCategory: "hate_speech", policyMode: "auto_hide_shadow", confidence: 0.9, decision: "would_auto_hide", reason: "shadow" } });
  const got = await prisma.autoProtectDecision.findUnique({ where: { itemId: AP_ITEM } });
  check("AutoProtectDecision persists", !!got && got.decision === "would_auto_hide" && got.matchedCategory === "hate_speech");

  // 12) tenant/brand isolation — brand A's policy differs and doesn't leak to B.
  const aPol = await prisma.brandAutoProtectPolicy.findFirst({ where: { tenantId: T, brandId: BRAND_A, category: "hate_speech", isActive: true } });
  const bPol = await prisma.brandAutoProtectPolicy.findFirst({ where: { tenantId: T, brandId: BRAND_B, category: "hate_speech", isActive: true } });
  check("brand A hate_speech policy = shadow", aPol?.mode === "auto_hide_shadow");
  check("brand B hate_speech policy = monitor (isolated)", bPol?.mode === "monitor");
  const bDecisions = await prisma.autoProtectDecision.count({ where: { tenantId: T, brandId: BRAND_B } });
  check("brand B has no decisions from brand A", bDecisions === 0);

  // Deactivate policy → excluded from active set (disabled policy ignored downstream).
  await prisma.brandAutoProtectPolicy.updateMany({ where: { tenantId: T, brandId: BRAND_A }, data: { isActive: false } });
  const activeA = await prisma.brandAutoProtectPolicy.count({ where: { tenantId: T, brandId: BRAND_A, isActive: true } });
  check("deactivated policy leaves active set", activeA === 0);

  // No platform-action columns exist on the decision (shadow only).
  check("decision has no execution/hidden field", got !== null && !("executed" in got) && !("hidden" in got));

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Auto-Protect DB persistence & isolation`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
