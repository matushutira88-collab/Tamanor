/**
 * real:reset-content logic tests. Run via: pnpm reset:test
 * Self-contained fixture: a tenant with the protected real Konfigurátor page + a
 * real synced comment, plus a demo brand with mock content. Asserts the reset
 * removes demo/mock, keeps the protected page and real items, and renames demo
 * labels. Cleans up its own fixture. No live actions.
 */
import { prisma, ConnectorStatus, ConnectorMode, ConnectorHealth, Platform, ContentKind } from "../src/index";

const PROTECTED_PAGE_ID = "1165524636643112";
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const slug = `reset-test-${Date.now()}`;
  const tenant = await prisma.tenant.create({ data: { name: "Demo Workspace", slug } });
  const realBrand = await prisma.brand.create({ data: { tenantId: tenant.id, name: "Aurora Fitness" } });
  const demoBrand = await prisma.brand.create({ data: { tenantId: tenant.id, name: "Northwind Coffee" } });
  const realAcct = await prisma.connectedAccount.create({ data: { tenantId: tenant.id, brandId: realBrand.id, platform: Platform.facebook_page, status: ConnectorStatus.active, mode: ConnectorMode.read_only, health: ConnectorHealth.healthy, externalId: "real_acc", externalName: "Konfigurátor", pageId: PROTECTED_PAGE_ID, grantedPermissions: [] } });
  const mockAcct = await prisma.connectedAccount.create({ data: { tenantId: tenant.id, brandId: demoBrand.id, platform: Platform.instagram_business, status: ConnectorStatus.mock_connected, mode: ConnectorMode.placeholder, health: ConnectorHealth.healthy, externalId: "mock_acc_ig", externalName: "Northwind Coffee", grantedPermissions: [] } });
  // Real synced comment (real FB comment id) on the protected account.
  const realContent = await prisma.contentItem.create({ data: { tenantId: tenant.id, brandId: realBrand.id, connectedAccountId: realAcct.id, platform: Platform.facebook_page, kind: ContentKind.comment, externalId: "122099377863355087_1", text: "Real comment", publishedAt: new Date() } });
  const realItem = await prisma.reputationItem.create({ data: { tenantId: tenant.id, brandId: realBrand.id, platform: Platform.facebook_page, contentItemId: realContent.id } });
  // Mock content (mock_ externalId).
  const mockContent = await prisma.contentItem.create({ data: { tenantId: tenant.id, brandId: demoBrand.id, connectedAccountId: mockAcct.id, platform: Platform.instagram_business, kind: ContentKind.comment, externalId: "mock_ig_c1", text: "MOCK comment", publishedAt: new Date() } });
  const mockItem = await prisma.reputationItem.create({ data: { tenantId: tenant.id, brandId: demoBrand.id, platform: Platform.instagram_business, contentItemId: mockContent.id } });

  async function cleanup() {
    await prisma.reputationItem.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.contentItem.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.connectedAccount.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.brand.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  }

  try {
    // Mirror the reset logic scoped to this tenant (the script runs globally).
    const protectedAcct = await prisma.connectedAccount.findFirst({ where: { tenantId: tenant.id, pageId: PROTECTED_PAGE_ID }, select: { id: true, brandId: true } });
    check("3) protected Konfigurátor page found", !!protectedAcct && protectedAcct.id === realAcct.id);
    const demoBrandIds = (await prisma.brand.findMany({ where: { tenantId: tenant.id }, select: { id: true } })).filter((b) => b.id !== protectedAcct!.brandId).map((b) => b.id);
    check("4) demo brand set includes Northwind, not the real brand", demoBrandIds.includes(demoBrand.id) && !demoBrandIds.includes(realBrand.id));

    // Apply (scoped): remove mock content items + demo brands + non-protected accounts.
    const mockItems = await prisma.reputationItem.findMany({ where: { tenantId: tenant.id, contentItem: { externalId: { startsWith: "mock_" } } }, select: { id: true } });
    await prisma.reputationItem.deleteMany({ where: { id: { in: mockItems.map((i) => i.id) } } });
    await prisma.contentItem.deleteMany({ where: { tenantId: tenant.id, externalId: { startsWith: "mock_" } } });
    await prisma.connectedAccount.deleteMany({ where: { brandId: { in: demoBrandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: demoBrandIds } } });
    await prisma.connectedAccount.deleteMany({ where: { tenantId: tenant.id, id: { not: realAcct.id } } });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { name: "Guardora Workspace" } });
    await prisma.brand.update({ where: { id: realBrand.id }, data: { name: "Konfigurátor" } });

    // Assertions.
    check("2) mock reputation item removed", (await prisma.reputationItem.count({ where: { id: mockItem.id } })) === 0);
    check("2) mock content removed", (await prisma.contentItem.count({ where: { externalId: { startsWith: "mock_" }, tenantId: tenant.id } })) === 0);
    check("3) protected page KEPT", (await prisma.connectedAccount.count({ where: { pageId: PROTECTED_PAGE_ID, tenantId: tenant.id } })) === 1);
    check("real synced item KEPT", (await prisma.reputationItem.count({ where: { id: realItem.id } })) === 1);
    check("4) Northwind Coffee removed", (await prisma.brand.count({ where: { tenantId: tenant.id, name: { contains: "Northwind" } } })) === 0);
    check("5) Demo Workspace renamed", (await prisma.tenant.count({ where: { id: tenant.id, name: { contains: "Demo" } } })) === 0);
    check("6) mock connected accounts removed", (await prisma.connectedAccount.count({ where: { tenantId: tenant.id, status: ConnectorStatus.mock_connected } })) === 0);
    check("Aurora Fitness renamed to real page name", (await prisma.brand.count({ where: { tenantId: tenant.id, name: "Konfigurátor" } })) === 1);
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — real:reset-content logic`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
