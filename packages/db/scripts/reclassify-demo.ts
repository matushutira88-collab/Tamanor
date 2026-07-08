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
import { prisma, Priority, RiskLevel, Sentiment } from "../src/index";
import { classifyHybrid, buildIntelFromHybrid, type ClassifierRule } from "@guardora/ai";

const force = process.env.RECLASSIFY_FORCE === "1";
const translation = {
  enabled: process.env.TRANSLATION_ENABLED === "true",
  provider: process.env.TRANSLATION_PROVIDER ?? "none",
  targetMode: (process.env.TRANSLATION_TARGET_MODE === "en" ? "en" : "workspace_locale") as "en" | "workspace_locale",
};
const aiRisk = {
  enabled: process.env.AI_RISK_PROVIDER_ENABLED === "true",
  provider: process.env.AI_RISK_PROVIDER ?? "none",
  minConfidence: Number(process.env.AI_RISK_MIN_CONFIDENCE ?? "0.7"),
};

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

  const brandList = await prisma.brand.findMany({ select: { id: true, defaultLocale: true } });
  const localeByBrand = new Map(brandList.map((b) => [b.id, b.defaultLocale]));

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

    const hybrid = await classifyHybrid(
      {
        text: it.contentItem.text,
        platform: it.platform as unknown as Parameters<typeof classifyHybrid>[0]["platform"],
        rating: it.contentItem.rating ?? undefined,
        rules: rulesByBrand.get(it.brandId) ?? [],
      },
      { workspaceLocale: localeByBrand.get(it.brandId) ?? "en", translation, aiRisk },
    );

    const wasCalm = it.riskLevel === RiskLevel.none || it.riskLevel === RiskLevel.low;
    const nowHot = hybrid.level === RiskLevel.high || hybrid.level === RiskLevel.critical;
    if (wasCalm && nowHot) escalated++;

    await prisma.reputationItem.update({
      where: { id: it.id },
      data: {
        riskLevel: hybrid.level as unknown as RiskLevel,
        riskConfidence: hybrid.confidence,
        riskCategories: hybrid.categories,
        sentiment: hybrid.sentiment as unknown as Sentiment,
        riskRationale: hybrid.explanation.shortReason || hybrid.engine,
        riskEngine: hybrid.engine,
        priority: priorityForRisk(hybrid.level),
        requiresApproval: hybrid.approvalRequired,
        assessedAt: new Date(),
        ...buildIntelFromHybrid(hybrid),
      },
    });
    // Observability: provider calls (no tokens/secrets/text).
    if (hybrid.providerCalls.length) {
      await prisma.providerCall.createMany({
        data: hybrid.providerCalls.map((c) => ({
          type: c.type, provider: c.provider, status: c.status, latencyMs: c.latencyMs,
          errorCode: c.errorCode ?? null, itemId: it.id, tenantId: it.tenantId, brandId: it.brandId,
        })),
      });
    }
    updated++;
  }

  console.log(`Updated ${updated}, skipped ${skipped} (has decisions), newly escalated to high/critical: ${escalated}.`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
