/**
 * Real reset — remove ALL demo/mock content and leave a clean real-only app.
 * Run via: pnpm real:reset-content   (dry-run)
 *          REAL_RESET_CONFIRM=YES pnpm real:reset-content   (apply)
 *
 * Keeps: the login tenant/user, the real Konfigurátor connected account
 * (pageId 1165524636643112) + its brand + real tokens. Removes: demo brands
 * (Northwind Coffee, and Aurora Fitness unless it hosts the real account),
 * all mock/demo connected accounts, all mock_ content + their reputation items /
 * auto-protect decisions / provider calls / platform actions, demo audit,
 * mock SyncRuns, and demo tenant/workspace labels. NEVER deletes the protected page.
 */
import { prisma } from "../src/index";

const PROTECTED_PAGE_ID = "1165524636643112";
const CONFIRM = process.env.REAL_RESET_CONFIRM === "YES";

async function run() {
  const protectedAcct = await prisma.connectedAccount.findFirst({
    where: { pageId: PROTECTED_PAGE_ID },
    select: { id: true, brandId: true, externalName: true, status: true },
  });
  const protectedBrandId = protectedAcct?.brandId ?? null;
  const protectedAccountId = protectedAcct?.id ?? null;

  // Mock content + their reputation items (mock_ externalId).
  const mockItems = await prisma.reputationItem.findMany({
    where: { contentItem: { externalId: { startsWith: "mock_" } } },
    select: { id: true },
  });
  const mockItemIds = mockItems.map((i) => i.id);

  // Demo brands = every brand that is NOT the protected real brand.
  const allBrands = await prisma.brand.findMany({ select: { id: true, name: true } });
  const demoBrands = allBrands.filter((b) => b.id !== protectedBrandId);
  const demoBrandIds = demoBrands.map((b) => b.id);

  // Non-protected connected accounts (mock/demo/disconnected) — everything except the real one.
  const removableAccounts = await prisma.connectedAccount.count({
    where: protectedAccountId ? { id: { not: protectedAccountId } } : {},
  });
  const mockSyncRuns = await prisma.syncRun.count({ where: { mock: true } });
  const demoTenant = await prisma.tenant.findFirst({ where: { name: { contains: "Demo" } }, select: { id: true, name: true } });

  console.log("=== real:reset-content — summary ===");
  console.log(`Protected real account: ${protectedAcct ? `${protectedAcct.externalName ?? "?"} (${PROTECTED_PAGE_ID}) — KEPT` : "NONE (clean slate)"}`);
  console.log(`Protected brand (kept): ${protectedBrandId ?? "none"}`);
  console.log(`Demo brands to remove: ${demoBrands.length} [${demoBrands.map((b) => b.name).join(", ")}]`);
  console.log(`Mock reputation items to remove: ${mockItemIds.length}`);
  console.log(`Non-protected connected accounts to remove: ${removableAccounts}`);
  console.log(`Mock SyncRuns to remove: ${mockSyncRuns}`);
  console.log(`Demo tenant/workspace label to rename: ${demoTenant ? demoTenant.name : "none"}`);

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing changed. Set REAL_RESET_CONFIRM=YES to apply.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // Safety: never touch the protected page.
  if (protectedAccountId) {
    const stillThere = await prisma.connectedAccount.findFirst({ where: { pageId: PROTECTED_PAGE_ID }, select: { id: true } });
    if (!stillThere) { console.error("⛔ protected page missing pre-flight — aborting."); process.exit(1); }
  }

  // 1) Remove mock reputation items and everything hanging off them (no FK cascade).
  if (mockItemIds.length) {
    await prisma.platformActionExecution.deleteMany({ where: { itemId: { in: mockItemIds } } });
    await prisma.providerCall.deleteMany({ where: { itemId: { in: mockItemIds } } });
    await prisma.autoProtectDecision.deleteMany({ where: { itemId: { in: mockItemIds } } });
    await prisma.moderationDecision.deleteMany({ where: { reputationItemId: { in: mockItemIds } } });
    await prisma.reputationItem.deleteMany({ where: { id: { in: mockItemIds } } });
  }
  await prisma.contentItem.deleteMany({ where: { externalId: { startsWith: "mock_" } } });

  // 2) Remove demo brands' scalar rows, then the brands (cascade removes their
  //    accounts / content / reputation / sync runs).
  if (demoBrandIds.length) {
    const w = { brandId: { in: demoBrandIds } };
    await prisma.platformActionExecution.deleteMany({ where: w });
    await prisma.autoProtectDecision.deleteMany({ where: w });
    await prisma.providerCall.deleteMany({ where: w });
    await prisma.brandRiskMemoryRule.deleteMany({ where: w });
    await prisma.brandRiskFeedback.deleteMany({ where: w });
    await prisma.brandAutoProtectPolicy.deleteMany({ where: w });
    await prisma.auditLog.deleteMany({ where: { brandId: { in: demoBrandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: demoBrandIds } } });
  }

  // 3) On the protected brand, remove every non-protected (mock/demo) account.
  if (protectedAccountId) {
    await prisma.connectedAccount.deleteMany({ where: { id: { not: protectedAccountId } } });
  }

  // 4) Mock SyncRuns (any left) + rename demo tenant + demo-named protected brand.
  await prisma.syncRun.deleteMany({ where: { mock: true } });
  if (demoTenant) await prisma.tenant.update({ where: { id: demoTenant.id }, data: { name: "Guardora Workspace" } });
  if (protectedBrandId) {
    const b = await prisma.brand.findUnique({ where: { id: protectedBrandId }, select: { name: true } });
    if (b && /aurora|northwind|demo/i.test(b.name)) {
      await prisma.brand.update({ where: { id: protectedBrandId }, data: { name: protectedAcct?.externalName ?? "Konfigurátor" } });
    }
  }

  const remainingMock = await prisma.contentItem.count({ where: { text: { contains: "MOCK" } } });
  console.log(`\n✅ Reset done. Protected page kept. Remaining [MOCK] content: ${remainingMock}.`);
  await prisma.$disconnect();
  process.exit(0);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
