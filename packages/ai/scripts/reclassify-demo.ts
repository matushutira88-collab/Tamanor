/**
 * Safe dev/test reclassification of existing ReputationItems with Risk Rules V1.
 *
 *   pnpm risk:reclassify-demo            # recompute risk for items WITHOUT decisions
 *   RECLASSIFY_FORCE=1 pnpm risk:reclassify-demo   # also recompute items with decisions
 *
 * Only the AI risk assessment fields are updated (level, confidence, categories,
 * sentiment, rationale, engine, priority, requiresApproval, assessedAt). Workflow
 * status is NOT changed. Items that already have a moderation decision (a human
 * touched them) are SKIPPED unless RECLASSIFY_FORCE=1 — never silently overwrite
 * live manual decisions. No platform action is performed.
 */
import { prisma, Priority, RiskLevel, Sentiment } from "@guardora/db";
import { RiskClassifier, type ClassifierRule } from "@guardora/ai";

const classifier = new RiskClassifier();
const force = process.env.RECLASSIFY_FORCE === "1";

function priorityForRisk(level: string): Priority {
  switch (level) {
    case RiskLevel.critical: return Priority.urgent;
    case RiskLevel.high: return Priority.high;
    case RiskLevel.medium: return Priority.normal;
    default: return Priority.low;
  }
}

async function main() {
  console.log(`Reclassify (Risk Rules V1)${force ? " [FORCE]" : ""} — decisions-guarded\n`);

  const items = await prisma.reputationItem.findMany({
    include: { contentItem: true, _count: { select: { decisions: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Preload brand rules once.
  const brandRules = await prisma.brandRule.findMany();
  const rulesByBrand = new Map<string, ClassifierRule[]>();
  for (const r of brandRules) {
    const arr = rulesByBrand.get(r.brandId) ?? [];
    arr.push({
      category: r.category as unknown as ClassifierRule["category"],
      phrases: r.phrases,
      enabled: r.enabled,
    });
    rulesByBrand.set(r.brandId, arr);
  }

  let updated = 0, skipped = 0, escalated = 0;
  for (const it of items) {
    if (it._count.decisions > 0 && !force) { skipped++; continue; }

    const risk = await classifier.classify({
      text: it.contentItem.text,
      platform: it.platform as unknown as Parameters<typeof classifier.classify>[0]["platform"],
      rating: it.contentItem.rating ?? undefined,
      rules: rulesByBrand.get(it.brandId) ?? [],
    });

    const wasCalm = it.riskLevel === RiskLevel.none || it.riskLevel === RiskLevel.low;
    const nowHot = risk.level === RiskLevel.high || risk.level === RiskLevel.critical;
    if (wasCalm && nowHot) escalated++;

    await prisma.reputationItem.update({
      where: { id: it.id },
      data: {
        riskLevel: risk.level as unknown as RiskLevel,
        riskConfidence: risk.confidence,
        riskCategories: risk.categories as unknown as string[],
        sentiment: risk.sentiment as unknown as Sentiment,
        riskRationale: risk.rationale ?? null,
        riskEngine: risk.engine ?? null,
        priority: priorityForRisk(risk.level),
        requiresApproval: nowHot,
        assessedAt: new Date(),
      },
    });
    updated++;
  }

  console.log(`Updated ${updated}, skipped ${skipped} (has decisions), newly escalated to high/critical: ${escalated}.`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
