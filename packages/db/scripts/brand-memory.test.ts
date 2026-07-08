/**
 * DB-level brand memory tests. Run via: pnpm memory:db-test
 * Verifies feedback persistence and strict tenant/brand isolation, then cleans up.
 * No platform action is ever performed.
 */
import { prisma } from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const T = "test_tenant_v117";
const BRAND_A = "test_brand_a_v117";
const BRAND_B = "test_brand_b_v117";

async function cleanup() {
  await prisma.brandRiskFeedback.deleteMany({ where: { tenantId: T } });
  await prisma.brandRiskMemoryRule.deleteMany({ where: { tenantId: T } });
}

async function run() {
  await cleanup();

  // 1) false_positive feedback is saved.
  await prisma.brandRiskFeedback.create({
    data: { tenantId: T, brandId: BRAND_A, itemId: "it1", actorId: "u1", feedbackType: "false_positive", originalRiskLevel: "high" },
  });
  // 2) false_negative feedback is saved.
  await prisma.brandRiskFeedback.create({
    data: { tenantId: T, brandId: BRAND_A, itemId: "it2", actorId: "u1", feedbackType: "false_negative", originalRiskLevel: "none" },
  });
  const fpCount = await prisma.brandRiskFeedback.count({ where: { tenantId: T, feedbackType: "false_positive" } });
  const fnCount = await prisma.brandRiskFeedback.count({ where: { tenantId: T, feedbackType: "false_negative" } });
  check("false_positive feedback saved", fpCount === 1);
  check("false_negative feedback saved", fnCount === 1);

  // Memory rules for two different brands.
  await prisma.brandRiskMemoryRule.create({
    data: { tenantId: T, brandId: BRAND_A, type: "block_phrase", phrase: "refund now", normalizedPhrase: "refund now", severity: "high", source: "manual", isActive: true },
  });
  await prisma.brandRiskMemoryRule.create({
    data: { tenantId: T, brandId: BRAND_B, type: "allow_phrase", phrase: "steal a deal", normalizedPhrase: "steal a deal", severity: "low", source: "manual", isActive: true },
  });

  // 10) brand isolation — brand A's active rules must NOT include brand B's.
  const brandARules = await prisma.brandRiskMemoryRule.findMany({ where: { tenantId: T, brandId: BRAND_A, isActive: true } });
  check("brand A sees only its own rule", brandARules.length === 1 && brandARules[0]!.type === "block_phrase");
  check("brand A does not see brand B's allow rule", !brandARules.some((r) => r.type === "allow_phrase"));

  const brandBRules = await prisma.brandRiskMemoryRule.findMany({ where: { tenantId: T, brandId: BRAND_B, isActive: true } });
  check("brand B sees only its own rule", brandBRules.length === 1 && brandBRules[0]!.type === "allow_phrase");

  // Deactivation excludes a rule from the active set.
  await prisma.brandRiskMemoryRule.updateMany({ where: { tenantId: T, brandId: BRAND_A }, data: { isActive: false } });
  const activeAfter = await prisma.brandRiskMemoryRule.count({ where: { tenantId: T, brandId: BRAND_A, isActive: true } });
  check("deactivated rule leaves active set", activeAfter === 0);

  await cleanup();
  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — brand memory DB isolation`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
