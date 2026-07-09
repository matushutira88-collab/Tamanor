/**
 * Safe demo-data cleanup for a real internal test. Run via: pnpm real:cleanup-demo
 *
 * Removes demo/mock data (brands with no real connected account) so a real
 * Facebook test is not polluted. NEVER deletes a real connected account and NEVER
 * deletes the protected Konfigurátor Page. Prints a summary and refuses to run
 * unless REAL_CLEANUP_CONFIRM=YES.
 */
import { prisma } from "../src/index";

const PROTECTED_PAGE_ID = "1165524636643112"; // Konfigurátor real Page — never delete.
const CONFIRM = process.env.REAL_CLEANUP_CONFIRM === "YES";

async function run() {
  // Real brands = brands with an active connected account OR the protected Page.
  const realAccounts = await prisma.connectedAccount.findMany({
    where: { OR: [{ status: "active" }, { pageId: PROTECTED_PAGE_ID }] },
    select: { brandId: true, pageId: true, externalName: true, status: true },
  });
  const realBrandIds = new Set(realAccounts.map((a) => a.brandId));

  const allBrands = await prisma.brand.findMany({ select: { id: true, name: true, tenantId: true } });
  const demoBrands = allBrands.filter((b) => !realBrandIds.has(b.id));
  const demoBrandIds = demoBrands.map((b) => b.id);

  // Safety: never let the protected page's brand fall into the demo set.
  const protectedAcct = await prisma.connectedAccount.findFirst({ where: { pageId: PROTECTED_PAGE_ID }, select: { brandId: true, externalName: true } });
  if (protectedAcct && demoBrandIds.includes(protectedAcct.brandId)) {
    console.error("⛔ Refusing: protected Konfigurátor page is in the demo set. Aborting.");
    process.exit(1);
  }

  // Summary of what WOULD be removed.
  const [repItems, apDecisions, provCalls, pae, memRules, feedback, apPolicies, mockAccounts] = await Promise.all([
    prisma.reputationItem.count({ where: { brandId: { in: demoBrandIds } } }),
    prisma.autoProtectDecision.count({ where: { brandId: { in: demoBrandIds } } }),
    prisma.providerCall.count({ where: { brandId: { in: demoBrandIds } } }),
    prisma.platformActionExecution.count({ where: { brandId: { in: demoBrandIds } } }),
    prisma.brandRiskMemoryRule.count({ where: { brandId: { in: demoBrandIds } } }),
    prisma.brandRiskFeedback.count({ where: { brandId: { in: demoBrandIds } } }),
    prisma.brandAutoProtectPolicy.count({ where: { brandId: { in: demoBrandIds } } }),
    prisma.connectedAccount.count({ where: { brandId: { in: demoBrandIds } } }),
  ]);

  console.log("=== real:cleanup-demo — summary ===");
  console.log(`Real accounts kept: ${realAccounts.length}${realAccounts.length ? " (" + realAccounts.map((a) => `${a.externalName ?? "?"}/${a.pageId ?? "?"}`).join(", ") + ")" : ""}`);
  console.log(`Protected page: ${protectedAcct ? `${protectedAcct.externalName ?? "?"} (${PROTECTED_PAGE_ID})` : "not connected"}`);
  console.log(`Demo brands to remove: ${demoBrands.length} [${demoBrands.map((b) => b.name).join(", ")}]`);
  console.log(`  reputation items: ${repItems}`);
  console.log(`  auto-protect decisions: ${apDecisions}`);
  console.log(`  provider calls: ${provCalls}`);
  console.log(`  platform action executions: ${pae}`);
  console.log(`  brand memory rules: ${memRules}, feedback: ${feedback}, auto-protect policies: ${apPolicies}`);
  console.log(`  mock/demo connected accounts: ${mockAccounts}`);

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing deleted. Set REAL_CLEANUP_CONFIRM=YES to apply.");
    await prisma.$disconnect();
    process.exit(0);
  }
  if (demoBrandIds.length === 0) {
    console.log("\nNo demo brands to remove. Done.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // Delete non-cascading rows explicitly, then the demo brands (cascade removes
  // their connected accounts, content items, reputation items, sync runs, etc.).
  const w = { brandId: { in: demoBrandIds } };
  await prisma.platformActionExecution.deleteMany({ where: w });
  await prisma.autoProtectDecision.deleteMany({ where: w });
  await prisma.providerCall.deleteMany({ where: w });
  await prisma.brandRiskMemoryRule.deleteMany({ where: w });
  await prisma.brandRiskFeedback.deleteMany({ where: w });
  await prisma.brandAutoProtectPolicy.deleteMany({ where: w });
  await prisma.auditLog.deleteMany({ where: { brandId: { in: demoBrandIds } } });
  await prisma.moderationDecision.deleteMany({ where: { reputationItem: { brandId: { in: demoBrandIds } } } });
  await prisma.brand.deleteMany({ where: { id: { in: demoBrandIds } } });

  console.log(`\n✅ Removed ${demoBrands.length} demo brand(s) and their data. Real accounts untouched.`);
  await prisma.$disconnect();
  process.exit(0);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
