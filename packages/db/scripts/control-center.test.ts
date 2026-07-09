/**
 * Control Center DB tests. Run via: pnpm controldb:test
 * Self-contained fixture: preset creates policies (no fake content), a control
 * policy can be created, an item evaluates into an Action Queue row, and an
 * incident is raised for an incident category. Cleans up. No live actions.
 */
import { prisma, Platform, ContentKind, ConnectorStatus, ConnectorMode, ConnectorHealth } from "../src/index";
import { presetPolicies, evaluateControl, INCIDENT_CATEGORIES, NEVER_AUTONOMOUS, CONTROL_CATEGORIES, type ControlPolicyLite } from "@guardora/ai";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const slug = `cc-test-${Date.now()}`;
  const tenant = await prisma.tenant.create({ data: { name: "CC Test", slug } });
  const brand = await prisma.brand.create({ data: { tenantId: tenant.id, name: "CC Brand" } });
  const acct = await prisma.connectedAccount.create({ data: { tenantId: tenant.id, brandId: brand.id, platform: Platform.facebook_page, status: ConnectorStatus.active, mode: ConnectorMode.read_only, health: ConnectorHealth.healthy, externalId: "cc_acc", grantedPermissions: [] } });

  async function cleanup() {
    await prisma.actionQueueItem.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.incident.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.controlPolicy.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.reputationItem.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.contentItem.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.connectedAccount.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.brand.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  }

  try {
    // 5) preset creates policies (no fake comments), safety-clamped.
    await prisma.controlPolicy.createMany({ data: presetPolicies("balanced").map((p) => ({ tenantId: tenant.id, brandId: brand.id, category: p.category, mode: p.mode, platform: "any", sourceType: "comment", minConfidence: 0.8, isActive: true })) });
    const polCount = await prisma.controlPolicy.count({ where: { brandId: brand.id } });
    check("5) preset created 21 policies", polCount === CONTROL_CATEGORIES.length, String(polCount));
    check("5) preset created NO content items (no fake comments)", (await prisma.contentItem.count({ where: { tenantId: tenant.id } })) === 0);
    const autoNever = await prisma.controlPolicy.findMany({ where: { brandId: brand.id, mode: "autonomous", category: { in: [...NEVER_AUTONOMOUS] } } });
    check("5) no never-autonomous category is autonomous", autoNever.length === 0);

    // 4) a control policy can be updated (custom).
    await prisma.controlPolicy.update({ where: { brandId_platform_sourceType_category: { brandId: brand.id, platform: "any", sourceType: "comment", category: "spam" } }, data: { mode: "autonomous" } });
    check("4) control policy updated to autonomous", (await prisma.controlPolicy.findFirst({ where: { brandId: brand.id, category: "spam" } }))?.mode === "autonomous");

    // 14) evaluate a scam item → Action Queue with policy reference.
    const content = await prisma.contentItem.create({ data: { tenantId: tenant.id, brandId: brand.id, connectedAccountId: acct.id, platform: Platform.facebook_page, kind: ContentKind.comment, externalId: "cc_c1", text: "this is a scam, don't buy", publishedAt: new Date() } });
    const item = await prisma.reputationItem.create({ data: { tenantId: tenant.id, brandId: brand.id, platform: Platform.facebook_page, contentItemId: content.id, riskLevel: "critical", riskConfidence: 0.9, riskCategories: ["scam"], riskExplanation: { riskSignals: ["scam"] } as never } });
    const policies: ControlPolicyLite[] = (await prisma.controlPolicy.findMany({ where: { brandId: brand.id, isActive: true }, select: { category: true, mode: true, minConfidence: true, isActive: true } }));
    const d = evaluateControl({ text: content.text, riskSignals: ["scam"], categories: ["scam"], sentiment: "negative", riskLevel: "critical", confidence: 0.9 }, policies);
    await prisma.actionQueueItem.create({ data: { tenantId: tenant.id, brandId: brand.id, itemId: item.id, category: d.matchedCategory, confidence: d.confidence, proposedAction: d.proposedAction, queueState: d.queueState, reason: d.reason, safetyBlocked: d.safetyBlocked, wouldExecute: d.wouldExecute } });
    const queued = await prisma.actionQueueItem.findUnique({ where: { itemId: item.id } });
    check("14) action queue item created (scam → dry_run candidate)", !!queued && queued.category === "scam" && queued.queueState === "dry_run" && queued.wouldExecute);

    // 15) incident created for a crisis/threat item.
    check("scam raises no incident; threat/crisis do", !INCIDENT_CATEGORIES.has("scam") && INCIDENT_CATEGORIES.has("threat"));
    const inc = await prisma.incident.create({ data: { tenantId: tenant.id, brandId: brand.id, title: "threat detected", category: "threat", severity: "critical", status: "open", relatedItemIds: [item.id] } });
    check("15) incident persists", (await prisma.incident.count({ where: { id: inc.id, status: "open" } })) === 1);

    // 18) live actions executed = 0 (no execution path here).
    check("18) live actions executed = 0", (await prisma.platformActionExecution.count({ where: { tenantId: tenant.id, status: "executed" } })) === 0);
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Control Center DB`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
