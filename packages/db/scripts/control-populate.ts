/**
 * Populate Control Center data from existing reputation items. Run via:
 *   pnpm control:populate
 * Creates default Control Policies (Balanced preset) for brands that have none,
 * then evaluates every reputation item into an ActionQueueItem and raises
 * Incidents for crisis/threat/coordinated/legal/safety categories. Idempotent.
 * Creates NO fake content — only rules + decisions for real items.
 */
import { prisma } from "../src/index";
import { evaluateControl, presetPolicies, INCIDENT_CATEGORIES, type ControlPolicyLite } from "@guardora/ai";

async function run() {
  const brands = await prisma.brand.findMany({ select: { id: true, tenantId: true, name: true } });

  // 1) Default Control Policies (Balanced) for brands with none.
  for (const b of brands) {
    const has = await prisma.controlPolicy.count({ where: { brandId: b.id } });
    if (has > 0) continue;
    await prisma.controlPolicy.createMany({
      data: presetPolicies("balanced").map((p) => ({
        tenantId: b.tenantId, brandId: b.id, category: p.category, mode: p.mode,
        platform: "any", sourceType: "comment", minConfidence: 0.8, isActive: true,
      })),
    });
  }

  // 2) Evaluate every reputation item → ActionQueueItem (+ incidents).
  const items = await prisma.reputationItem.findMany({
    include: { contentItem: { select: { text: true } } },
  });
  let queued = 0, incidents = 0;
  const policiesByBrand = new Map<string, ControlPolicyLite[]>();

  for (const it of items) {
    if (!policiesByBrand.has(it.brandId)) {
      const rows = await prisma.controlPolicy.findMany({ where: { brandId: it.brandId, isActive: true }, select: { category: true, mode: true, minConfidence: true, isActive: true } });
      policiesByBrand.set(it.brandId, rows);
    }
    const expl = (it.riskExplanation ?? {}) as { riskSignals?: string[] };
    const decision = evaluateControl({
      text: it.contentItem.text,
      riskSignals: expl.riskSignals ?? [],
      categories: it.riskCategories,
      sentiment: it.sentiment as unknown as string,
      riskLevel: it.riskLevel as unknown as string,
      confidence: it.riskConfidence,
    }, policiesByBrand.get(it.brandId)!);

    await prisma.actionQueueItem.upsert({
      where: { itemId: it.id },
      create: { tenantId: it.tenantId, brandId: it.brandId, itemId: it.id, category: decision.matchedCategory, confidence: decision.confidence, proposedAction: decision.proposedAction, queueState: decision.queueState, reason: decision.reason, safetyBlocked: decision.safetyBlocked, wouldExecute: decision.wouldExecute },
      update: { category: decision.matchedCategory, confidence: decision.confidence, proposedAction: decision.proposedAction, queueState: decision.queueState, reason: decision.reason, safetyBlocked: decision.safetyBlocked, wouldExecute: decision.wouldExecute },
    });
    queued++;

    // Incident for eligible categories at high/critical risk (dedup by brand+category open).
    if (INCIDENT_CATEGORIES.has(decision.matchedCategory) && ["high", "critical"].includes(it.riskLevel as unknown as string)) {
      const open = await prisma.incident.findFirst({ where: { brandId: it.brandId, category: decision.matchedCategory, status: "open" } });
      if (open) {
        if (!open.relatedItemIds.includes(it.id)) {
          await prisma.incident.update({ where: { id: open.id }, data: { relatedItemIds: { push: it.id } } });
        }
      } else {
        await prisma.incident.create({ data: { tenantId: it.tenantId, brandId: it.brandId, title: `${decision.matchedCategory.replace(/_/g, " ")} detected`, category: decision.matchedCategory, severity: it.riskLevel === "critical" ? "critical" : "high", status: "open", sourcePlatform: it.platform as unknown as string, relatedItemIds: [it.id] } });
        incidents++;
      }
    }
  }

  console.log(`Control Center populated: ${queued} queue items, ${incidents} incidents, policies for ${brands.length} brand(s).`);
  await prisma.$disconnect();
  process.exit(0);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
