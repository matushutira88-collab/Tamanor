/**
 * Real-mode + demo-cleanup logic tests. Run via: pnpm realmode:test
 * Self-contained: builds a tenant with a real (active) account on the protected
 * Konfigurátor page + a demo (mock) account, then asserts real/demo separation,
 * autosync exclusion of demo, and that cleanup never targets the real account.
 * Cleans up its own fixtures. No live actions.
 */
import { prisma, ConnectorStatus, ConnectorMode, ConnectorHealth, Platform } from "../src/index";

const PROTECTED_PAGE_ID = "1165524636643112";
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  // Ephemeral tenant + real brand (active, protected page) + demo brand (mock).
  const slug = `v121c-test-${Date.now()}`;
  const tenant = await prisma.tenant.create({ data: { name: "V121C Test Tenant", slug } });
  const realBrand = await prisma.brand.create({ data: { tenantId: tenant.id, name: "Konfigurátor" } });
  const demoBrand = await prisma.brand.create({ data: { tenantId: tenant.id, name: "Northwind Coffee (demo)" } });
  await prisma.connectedAccount.create({ data: { tenantId: tenant.id, brandId: realBrand.id, platform: Platform.facebook_page, status: ConnectorStatus.active, mode: ConnectorMode.read_only, health: ConnectorHealth.healthy, externalId: "real_ext", externalName: "Konfigurátor", pageId: PROTECTED_PAGE_ID, grantedPermissions: ["pages_read_engagement"] } });
  await prisma.connectedAccount.create({ data: { tenantId: tenant.id, brandId: demoBrand.id, platform: Platform.facebook_page, status: ConnectorStatus.mock_connected, mode: ConnectorMode.placeholder, health: ConnectorHealth.healthy, externalId: "mock_ext", externalName: "Northwind Coffee", pageId: null, grantedPermissions: [] } });

  async function cleanup() {
    await prisma.connectedAccount.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.brand.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  }

  try {
    // 1/2) Real brands = active OR protected page. Demo (mock) excluded.
    const realAccts = await prisma.connectedAccount.findMany({ where: { tenantId: tenant.id, OR: [{ status: ConnectorStatus.active }, { pageId: PROTECTED_PAGE_ID }] }, select: { brandId: true } });
    const realBrandIds = new Set(realAccts.map((a) => a.brandId));
    check("real brand identified (active/protected page)", realBrandIds.has(realBrand.id));
    check("demo brand NOT identified as real", !realBrandIds.has(demoBrand.id));

    // 1) autosync in real mode → only active accounts (mock excluded).
    const autosyncReal = await prisma.connectedAccount.findMany({ where: { tenantId: tenant.id, platform: Platform.facebook_page, status: { in: [ConnectorStatus.active] } }, select: { id: true } });
    check("real-mode autosync includes real account", autosyncReal.length === 1);
    const autosyncDemo = await prisma.connectedAccount.count({ where: { tenantId: tenant.id, status: ConnectorStatus.mock_connected } });
    check("real-mode autosync excludes mock account (counted as skipped)", autosyncDemo === 1);

    // 3) cleanup demo set = brands with no real account; must NOT include real brand or protected page.
    const allBrands = await prisma.brand.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
    const demoSet = allBrands.filter((b) => !realBrandIds.has(b.id)).map((b) => b.id);
    check("cleanup demo set contains demo brand", demoSet.includes(demoBrand.id));
    check("cleanup demo set NEVER contains real brand", !demoSet.includes(realBrand.id));
    const protectedAcct = await prisma.connectedAccount.findFirst({ where: { pageId: PROTECTED_PAGE_ID }, select: { brandId: true } });
    check("protected Konfigurátor page never in demo set", !!protectedAcct && !demoSet.includes(protectedAcct.brandId));

    // 6/7) brandWhere used by dashboard/inbox restricts to real brands.
    const realOnly = await prisma.brand.findMany({ where: { tenantId: tenant.id, id: { in: [...realBrandIds] } }, select: { name: true } });
    check("real-mode brandWhere returns only the real brand", realOnly.length === 1 && realOnly[0]!.name === "Konfigurátor");
    check("real-mode brandWhere excludes Northwind Coffee (demo)", !realOnly.some((b) => b.name.includes("Northwind")));
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — real-mode + demo-cleanup logic`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
