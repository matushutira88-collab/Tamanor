/**
 * DB-level Auto-Protect tests. Run via: pnpm autoprotect:db-test
 * Verifies decision persistence, policy/decision tenant+brand isolation, and that
 * no platform-action state is written. Cleans up after itself.
 */
import { prisma } from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const T = "test_tenant_v118";
const BRAND_A = "test_brand_a_v118";
const BRAND_B = "test_brand_b_v118";

async function cleanup() {
  await prisma.autoProtectDecision.deleteMany({ where: { tenantId: T } });
  await prisma.brandAutoProtectPolicy.deleteMany({ where: { tenantId: T } });
}

async function run() {
  await cleanup();

  // Policies for two brands.
  await prisma.brandAutoProtectPolicy.create({ data: { tenantId: T, brandId: BRAND_A, category: "hate_speech", mode: "auto_hide_shadow", minConfidence: 0.7, isActive: true } });
  await prisma.brandAutoProtectPolicy.create({ data: { tenantId: T, brandId: BRAND_B, category: "hate_speech", mode: "monitor", minConfidence: 0.7, isActive: true } });

  // 11) decision persists.
  await prisma.autoProtectDecision.create({ data: { tenantId: T, brandId: BRAND_A, itemId: "ap_item_1", matchedCategory: "hate_speech", policyMode: "auto_hide_shadow", confidence: 0.9, decision: "would_auto_hide", reason: "shadow" } });
  const got = await prisma.autoProtectDecision.findUnique({ where: { itemId: "ap_item_1" } });
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
