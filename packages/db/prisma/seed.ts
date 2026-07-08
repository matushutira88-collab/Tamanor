/**
 * Guardora dev seed.
 *
 * Creates INTERNAL development data only, clearly marked as mock. It does not
 * impersonate real clients or brands, and it performs no network calls. Content
 * is run through the placeholder RiskClassifier (including brand rules) exactly
 * as the worker would, so the inbox reflects the real classification path.
 *
 * Safe to re-run: it truncates Guardora tables first.
 */
import {
  PrismaClient,
  Platform,
  Role,
  BrandStatus,
  BrandTone,
  ConnectorStatus,
  ContentKind,
  ReputationStatus,
  Priority,
  RiskLevel,
  Sentiment,
  RuleCategory,
  ActorKind,
  ModerationAction,
  DecisionStatus,
  SyncRunStatus,
} from "@prisma/client";
import { RiskClassifier } from "@guardora/ai";
import type { ClassifierRule } from "@guardora/ai";

const prisma = new PrismaClient();
const classifier = new RiskClassifier();

const MOCK = "[MOCK]";

/** Map a core RiskLevel string to a triage Priority. */
function priorityForRisk(level: string): Priority {
  switch (level) {
    case RiskLevel.critical:
      return Priority.urgent;
    case RiskLevel.high:
      return Priority.high;
    case RiskLevel.medium:
      return Priority.normal;
    default:
      return Priority.low;
  }
}

interface SeedItem {
  platform: Platform;
  kind: ContentKind;
  text: string;
  author: string;
  rating?: number;
  daysAgo: number;
  /** Optional explicit workflow status; defaults to classified. */
  status?: ReputationStatus;
}

async function main() {
  console.log(`${MOCK} Seeding Guardora dev data...`);

  // --- Reset (dev only) ------------------------------------------------------
  await prisma.auditLog.deleteMany();
  await prisma.moderationDecision.deleteMany();
  await prisma.reputationItem.deleteMany();
  await prisma.contentItem.deleteMany();
  await prisma.brandRule.deleteMany();
  await prisma.connectedAccount.deleteMany();
  await prisma.reportSnapshot.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.user.deleteMany();

  // --- Tenant + user + membership -------------------------------------------
  const tenant = await prisma.tenant.create({
    data: {
      name: `${MOCK} Guardora Dev Workspace`,
      slug: "dev",
      plan: "dev",
    },
  });

  const user = await prisma.user.create({
    data: {
      email: "dev@guardora.ai",
      name: "Dev User",
      locale: "en",
    },
  });

  await prisma.membership.create({
    data: { userId: user.id, tenantId: tenant.id, role: Role.owner },
  });

  // --- Brands ----------------------------------------------------------------
  const coffee = await prisma.brand.create({
    data: {
      tenantId: tenant.id,
      name: `${MOCK} Northwind Coffee`,
      displayName: "Northwind Coffee",
      defaultLocale: "en",
      timezone: "Europe/Bratislava",
      defaultTone: BrandTone.friendly,
      status: BrandStatus.active,
    },
  });

  const fitness = await prisma.brand.create({
    data: {
      tenantId: tenant.id,
      name: `${MOCK} Aurora Fitness`,
      displayName: "Aurora Fitness",
      defaultLocale: "en",
      timezone: "America/New_York",
      defaultTone: BrandTone.empathetic,
      status: BrandStatus.active,
    },
  });

  // --- Brand rules -----------------------------------------------------------
  await prisma.brandRule.createMany({
    data: [
      {
        tenantId: tenant.id,
        brandId: coffee.id,
        name: "Blocked words",
        category: RuleCategory.blocked_words,
        phrases: ["scam", "ripoff", "garbage"],
        enabled: true,
      },
      {
        tenantId: tenant.id,
        brandId: coffee.id,
        name: "Competitors",
        category: RuleCategory.competitor_mentions,
        phrases: ["beanmaster", "roastly"],
        enabled: true,
      },
      {
        tenantId: tenant.id,
        brandId: coffee.id,
        name: "Crisis terms",
        category: RuleCategory.crisis_keywords,
        phrases: ["food poisoning", "lawsuit", "boycott"],
        enabled: true,
      },
      {
        tenantId: tenant.id,
        brandId: fitness.id,
        name: "Crisis terms",
        category: RuleCategory.crisis_keywords,
        phrases: ["injury", "dangerous", "refund scam"],
        enabled: true,
      },
      {
        tenantId: tenant.id,
        brandId: fitness.id,
        name: "Competitors",
        category: RuleCategory.competitor_mentions,
        phrases: ["fitpro", "gymly"],
        enabled: false,
      },
    ],
  });

  // Load active rules per brand for the classifier.
  const rulesByBrand = new Map<string, ClassifierRule[]>();
  for (const brandId of [coffee.id, fitness.id]) {
    const rules = await prisma.brandRule.findMany({
      where: { brandId, enabled: true },
    });
    rulesByBrand.set(
      brandId,
      rules.map((r) => ({
        category: r.category as unknown as ClassifierRule["category"],
        phrases: r.phrases,
        enabled: r.enabled,
      })),
    );
  }

  // --- Connected accounts (mock only) ---------------------------------------
  const accounts = await Promise.all([
    // Northwind Coffee
    mkAccount(tenant.id, coffee.id, Platform.facebook_page, ConnectorStatus.mock_connected, "Northwind Coffee"),
    mkAccount(tenant.id, coffee.id, Platform.instagram_business, ConnectorStatus.mock_connected, "@northwindcoffee"),
    mkAccount(tenant.id, coffee.id, Platform.google_business, ConnectorStatus.mock_connected, "Northwind Coffee — Main St"),
    mkAccount(tenant.id, coffee.id, Platform.youtube, ConnectorStatus.disconnected, "Northwind Coffee"),
    // Aurora Fitness
    mkAccount(tenant.id, fitness.id, Platform.youtube, ConnectorStatus.mock_connected, "Aurora Fitness"),
    mkAccount(tenant.id, fitness.id, Platform.linkedin_company, ConnectorStatus.mock_connected, "Aurora Fitness"),
    mkAccount(tenant.id, fitness.id, Platform.tiktok, ConnectorStatus.mock_connected, "@aurorafitness"),
  ]);

  const acc = (brandId: string, platform: Platform) =>
    accounts.find((a) => a.brandId === brandId && a.platform === platform)!;

  // --- Reputation items (20) -------------------------------------------------
  const coffeeItems: SeedItem[] = [
    { platform: Platform.facebook_page, kind: ContentKind.comment, text: "Best flat white in town, staff are lovely!", author: "maria_k", daysAgo: 1, status: ReputationStatus.resolved },
    { platform: Platform.facebook_page, kind: ContentKind.comment, text: "This place is a total scam, they overcharged me. Ripoff!", author: "angry_dave", daysAgo: 1 },
    { platform: Platform.facebook_page, kind: ContentKind.comment, text: "Do you have oat milk options?", author: "vegan_life", daysAgo: 2, status: ReputationStatus.classified },
    { platform: Platform.instagram_business, kind: ContentKind.comment, text: "Free crypto giveaway!! click here to win 🎁", author: "promo_bot_88", daysAgo: 1 },
    { platform: Platform.instagram_business, kind: ContentKind.comment, text: "Beanmaster does it cheaper tbh", author: "coffee_snob", daysAgo: 3 },
    { platform: Platform.instagram_business, kind: ContentKind.comment, text: "Obsessed with the new autumn cups 😍", author: "latteart", daysAgo: 2, status: ReputationStatus.resolved },
    { platform: Platform.google_business, kind: ContentKind.review, text: "Got food poisoning after the sandwich here. Never again.", author: "J. Powell", rating: 1, daysAgo: 1, status: ReputationStatus.escalated },
    { platform: Platform.google_business, kind: ContentKind.review, text: "Cozy spot, friendly baristas. Coffee was a little cold.", author: "S. Nguyen", rating: 4, daysAgo: 4 },
    { platform: Platform.google_business, kind: ContentKind.review, text: "Terrible service, waited 20 minutes. Worst cafe.", author: "T. Brooks", rating: 2, daysAgo: 2 },
    { platform: Platform.google_business, kind: ContentKind.review, text: "Absolutely lovely, my new favourite. Highly recommend!", author: "R. Alvarez", rating: 5, daysAgo: 5, status: ReputationStatus.resolved },
  ];

  const fitnessItems: SeedItem[] = [
    { platform: Platform.youtube, kind: ContentKind.comment, text: "This workout caused an injury to my knee, be careful.", author: "runner_tom", daysAgo: 1, status: ReputationStatus.needs_approval },
    { platform: Platform.youtube, kind: ContentKind.comment, text: "Great form cues, subscribed!", author: "gains_gary", daysAgo: 2 },
    { platform: Platform.youtube, kind: ContentKind.comment, text: "Buy now! promo code FITSCAM for followers 🔥", author: "spam_channel", daysAgo: 1 },
    { platform: Platform.youtube, kind: ContentKind.comment, text: "Can you do a beginner version of this?", author: "newbie_jen", daysAgo: 3, status: ReputationStatus.classified },
    { platform: Platform.linkedin_company, kind: ContentKind.comment, text: "Impressive corporate wellness results, well done team.", author: "HR Director", daysAgo: 2 },
    { platform: Platform.linkedin_company, kind: ContentKind.comment, text: "Your app charged me twice — this feels like a refund scam.", author: "M. Fischer", daysAgo: 1, status: ReputationStatus.needs_approval },
    { platform: Platform.linkedin_company, kind: ContentKind.comment, text: "Would love to partner on a webinar.", author: "L. Osei", daysAgo: 4 },
    { platform: Platform.tiktok, kind: ContentKind.comment, text: "shut up loser nobody asked", author: "troll_x", daysAgo: 1 },
    { platform: Platform.tiktok, kind: ContentKind.comment, text: "the transition at 0:15 is insane 🤩", author: "dance_fan", daysAgo: 2, status: ReputationStatus.resolved },
    { platform: Platform.tiktok, kind: ContentKind.comment, text: "is this routine dangerous for bad backs?", author: "careful_cathy", daysAgo: 3 },
  ];

  let created = 0;
  for (const [brandId, items] of [
    [coffee.id, coffeeItems] as const,
    [fitness.id, fitnessItems] as const,
  ]) {
    for (const item of items) {
      await createReputationItem(tenant.id, brandId, acc(brandId, item.platform).id, item, rulesByBrand.get(brandId) ?? []);
      created++;
    }
  }

  // --- Moderation proposals (approval workflow examples) ---------------------
  // 1) PENDING hide, proposed by AI (Facebook — hide supported)
  await seedProposal("total scam", {
    action: ModerationAction.hide,
    status: DecisionStatus.proposed,
    proposedByKind: ActorKind.ai,
    reason: "High-risk scam/blocked-word match. Proposed for review.",
  });
  // 2) APPROVED (not executed) reply, proposed by a user (Google — reply supported)
  await seedProposal("Terrible service", {
    action: ModerationAction.reply,
    status: DecisionStatus.approved,
    proposedByKind: ActorKind.human,
    proposedByUserId: user.id,
    reviewerUserId: user.id,
    replyText: "We're sorry about the wait — please DM us so we can make this right.",
    reason: "Public complaint; drafted an empathetic reply.",
  });
  // 3) REJECTED delete (Instagram spam)
  await seedProposal("crypto giveaway", {
    action: ModerationAction.delete,
    status: DecisionStatus.rejected,
    proposedByKind: ActorKind.human,
    proposedByUserId: user.id,
    reviewerUserId: user.id,
    reason: "Proposed delete for spam; reviewer chose to hide instead.",
    itemStatus: ReputationStatus.classified,
  });
  // 4) FAILED hide on an unsupported platform (LinkedIn — no API hide)
  await seedProposal("refund scam", {
    action: ModerationAction.hide,
    status: DecisionStatus.failed,
    proposedByKind: ActorKind.human,
    proposedByUserId: user.id,
    reviewerUserId: user.id,
    failureReason: "hide is not supported by the linkedin_company API.",
    reason: "Attempted hide; platform API does not support hiding.",
    itemStatus: ReputationStatus.classified,
  });

  // --- Larger [MOCK] demo dataset (nicer charts) -----------------------------
  const mockAccounts = accounts
    .filter((a) => a.status === ConnectorStatus.mock_connected)
    .map((a) => ({ brandId: a.brandId, accountId: a.id, platform: a.platform }));
  const demoCount = await seedDemoDataset(tenant.id, mockAccounts, rulesByBrand);

  // A couple more proposals sourced from the demo dataset.
  await seedProposal("misleading claims", {
    action: ModerationAction.reply,
    status: DecisionStatus.proposed,
    proposedByKind: ActorKind.ai,
    reason: "Possible misinformation — drafted a factual reply for review.",
  });
  await seedProposal("boycott", {
    action: ModerationAction.escalate,
    status: DecisionStatus.proposed,
    proposedByKind: ActorKind.ai,
    reason: "Crisis keyword detected — proposed escalation.",
  });

  // --- Seed audit entry ------------------------------------------------------
  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      event: "seed.completed",
      actorKind: ActorKind.system,
      metadata: {
        note: `${MOCK} dev seed`,
        brands: 2,
        connectedAccounts: accounts.length,
        reputationItems: created,
      },
    },
  });

  console.log(`${MOCK} Done: 1 tenant, 1 user, 2 brands, ${accounts.length} accounts, ${created + demoCount} reputation items (incl. ${demoCount} demo).`);
}

/** Larger clearly-[MOCK] demo dataset spread across ~14 days for nicer charts. */
const DEMO_TEXTS: Array<{ text: string; author: string; rating?: number }> = [
  { text: "[MOCK] Absolutely love this brand, best in the market!", author: "happy_customer" },
  { text: "[MOCK] Great support team, solved my issue fast.", author: "grateful_gus" },
  { text: "[MOCK] Do you ship to Germany?", author: "curious_klaus" },
  { text: "[MOCK] total scam, they took my money and ghosted me", author: "angry_ana" },
  { text: "[MOCK] Free crypto giveaway!! click here to claim now 🎁", author: "promo_bot_42" },
  { text: "[MOCK] worst service ever, want a refund immediately", author: "upset_ULF" },
  { text: "[MOCK] these misleading claims are false advertising", author: "skeptic_sam" },
  { text: "[MOCK] we should boycott this company after what happened", author: "activist_al" },
  { text: "[MOCK] shut up nobody asked for your opinion", author: "troll_t" },
  { text: "[MOCK] Competitor Beanmaster is way cheaper honestly", author: "bargain_bob" },
  { text: "[MOCK] The new update looks fantastic, well done!", author: "fan_fiona" },
  { text: "[MOCK] my order arrived broken and no one replied", author: "let_down_lily" },
  { text: "[MOCK] is this product safe for kids?", author: "parent_pat" },
  { text: "[MOCK] you scammed me, I'm calling my lawyer", author: "furious_fred" },
  { text: "[MOCK] amazing quality, will recommend to friends", author: "loyal_lena", rating: 5 },
  { text: "[MOCK] mediocre experience, expected more for the price", author: "meh_mike", rating: 3 },
  { text: "[MOCK] terrible, got food poisoning, avoid!", author: "sick_steph", rating: 1 },
  { text: "[MOCK] neutral comment about the weather today", author: "random_rob" },
];

interface MockAccount {
  brandId: string;
  accountId: string;
  platform: Platform;
}

function demoStatus(level: string, i: number): ReputationStatus {
  if (level === RiskLevel.critical || level === RiskLevel.high) {
    return i % 3 === 0 ? ReputationStatus.needs_approval : ReputationStatus.classified;
  }
  if (level === RiskLevel.medium) return ReputationStatus.classified;
  return i % 4 === 0 ? ReputationStatus.resolved : i % 4 === 1 ? ReputationStatus.ignored : ReputationStatus.classified;
}

async function seedDemoDataset(
  tenantId: string,
  mockAccounts: MockAccount[],
  rulesByBrand: Map<string, ClassifierRule[]>,
): Promise<number> {
  if (mockAccounts.length === 0) return 0;
  let n = 0;
  for (let day = 13; day >= 0; day--) {
    const perDay = 3 + (day % 4); // 3..6 items/day
    for (let k = 0; k < perDay; k++) {
      const acct = mockAccounts[n % mockAccounts.length]!;
      const tpl = DEMO_TEXTS[(n * 7 + day * 3) % DEMO_TEXTS.length]!;
      const when = new Date(Date.now() - day * 86_400_000 - ((n % 12) * 3_600_000));

      const risk = await classifier.classify({
        text: tpl.text,
        platform: acct.platform as unknown as Parameters<typeof classifier.classify>[0]["platform"],
        rating: tpl.rating,
        rules: rulesByBrand.get(acct.brandId) ?? [],
      });

      const content = await prisma.contentItem.create({
        data: {
          tenantId,
          brandId: acct.brandId,
          connectedAccountId: acct.accountId,
          platform: acct.platform,
          kind: ContentKind.comment,
          externalId: `mock_demo_${n}_${Math.random().toString(36).slice(2, 9)}`,
          text: tpl.text,
          authorDisplayName: tpl.author,
          rating: tpl.rating ?? null,
          publishedAt: when,
          ingestedAt: when,
        },
      });

      await prisma.reputationItem.create({
        data: {
          tenantId,
          brandId: acct.brandId,
          platform: acct.platform,
          contentItemId: content.id,
          status: demoStatus(risk.level, n),
          priority: priorityForRisk(risk.level),
          requiresApproval: risk.level === RiskLevel.high || risk.level === RiskLevel.critical,
          riskLevel: risk.level as unknown as RiskLevel,
          riskConfidence: risk.confidence,
          riskCategories: risk.categories as unknown as string[],
          sentiment: risk.sentiment as unknown as Sentiment,
          riskRationale: risk.rationale ?? null,
          riskEngine: risk.engine ?? null,
          assessedAt: when,
          createdAt: when,
        },
      });
      n++;
    }
  }

  // Extra sync runs for richer sync history.
  for (const acct of mockAccounts) {
    for (let r = 0; r < 5; r++) {
      const fetched = 2 + ((r * 3) % 7);
      const deduped = r === 0 ? 0 : Math.max(0, fetched - 2);
      const at = new Date(Date.now() - r * 86_400_000);
      await prisma.syncRun.create({
        data: {
          tenantId,
          brandId: acct.brandId,
          connectedAccountId: acct.accountId,
          status: SyncRunStatus.completed,
          mock: true,
          fetched,
          created: r === 0 ? fetched : Math.max(0, fetched - deduped),
          deduped,
          durationMs: 120 + r * 45,
          startedAt: at,
          finishedAt: new Date(at.getTime() + 320),
        },
      });
    }
  }

  return n;
}

async function mkAccount(
  tenantId: string,
  brandId: string,
  platform: Platform,
  status: ConnectorStatus,
  externalName: string,
) {
  return prisma.connectedAccount.create({
    data: {
      tenantId,
      brandId,
      platform,
      status,
      externalId: `mock_${platform}_${brandId.slice(-6)}`,
      externalName,
      scopes: [],
    },
  });
}

async function createReputationItem(
  tenantId: string,
  brandId: string,
  connectedAccountId: string,
  item: SeedItem,
  rules: ClassifierRule[],
) {
  const publishedAt = new Date(Date.now() - item.daysAgo * 86_400_000);

  const risk = await classifier.classify({
    text: item.text,
    platform: item.platform as unknown as Parameters<typeof classifier.classify>[0]["platform"],
    rating: item.rating,
    rules,
  });

  const content = await prisma.contentItem.create({
    data: {
      tenantId,
      brandId,
      connectedAccountId,
      platform: item.platform,
      kind: item.kind,
      externalId: `mock_${Math.random().toString(36).slice(2, 11)}`,
      text: item.text,
      authorDisplayName: item.author,
      rating: item.rating ?? null,
      permalink: null,
      publishedAt,
    },
  });

  const status = item.status ?? ReputationStatus.classified;
  await prisma.reputationItem.create({
    data: {
      tenantId,
      brandId,
      platform: item.platform,
      contentItemId: content.id,
      status,
      priority: priorityForRisk(risk.level),
      requiresApproval:
        risk.level === RiskLevel.high || risk.level === RiskLevel.critical,
      riskLevel: risk.level as unknown as RiskLevel,
      riskConfidence: risk.confidence,
      riskCategories: risk.categories as unknown as string[],
      sentiment: risk.sentiment as unknown as Sentiment,
      riskRationale: risk.rationale ?? null,
      riskEngine: risk.engine ?? null,
      assessedAt: new Date(),
    },
  });
}

interface SeedProposalOpts {
  action: ModerationAction;
  status: DecisionStatus;
  proposedByKind: ActorKind;
  proposedByUserId?: string;
  reviewerUserId?: string;
  replyText?: string;
  reason?: string;
  failureReason?: string;
  itemStatus?: ReputationStatus;
}

const OPEN_STATUSES: DecisionStatus[] = [
  DecisionStatus.proposed,
  DecisionStatus.approved,
];

/** Create a proposal against the first reputation item whose text matches. */
async function seedProposal(textNeedle: string, opts: SeedProposalOpts) {
  const item = await prisma.reputationItem.findFirst({
    where: { contentItem: { text: { contains: textNeedle } } },
  });
  if (!item) {
    console.warn(`${MOCK} seedProposal: no item matching "${textNeedle}"`);
    return;
  }

  const decision = await prisma.moderationDecision.create({
    data: {
      tenantId: item.tenantId,
      brandId: item.brandId,
      reputationItemId: item.id,
      action: opts.action,
      status: opts.status,
      proposedByKind: opts.proposedByKind,
      proposedByUserId: opts.proposedByUserId ?? null,
      replyText: opts.replyText ?? null,
      reason: opts.reason ?? null,
      confidence: item.riskConfidence,
      riskSnapshot: {
        level: item.riskLevel,
        confidence: item.riskConfidence,
        categories: item.riskCategories,
        sentiment: item.sentiment,
      },
      reviewerUserId: opts.reviewerUserId ?? null,
      reviewedAt: opts.reviewerUserId ? new Date() : null,
      executedAt: opts.status === DecisionStatus.executed ? new Date() : null,
      failureReason: opts.failureReason ?? null,
    },
  });

  const open = OPEN_STATUSES.includes(opts.status);
  await prisma.reputationItem.update({
    where: { id: item.id },
    data: {
      status: opts.itemStatus ?? (open ? ReputationStatus.needs_approval : item.status),
      requiresApproval: open,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: item.tenantId,
      brandId: item.brandId,
      event: "proposal.created",
      actorKind: opts.proposedByKind,
      actorUserId: opts.proposedByUserId ?? null,
      targetType: "moderation_decision",
      targetId: decision.id,
      metadata: { action: opts.action, seeded: true },
    },
  });

  if (opts.status !== DecisionStatus.proposed) {
    const event =
      opts.status === DecisionStatus.approved
        ? "proposal.approved"
        : opts.status === DecisionStatus.rejected
          ? "proposal.rejected"
          : opts.status === DecisionStatus.executed
            ? "proposal.executed"
            : opts.status === DecisionStatus.failed
              ? "proposal.failed"
              : "proposal.cancelled";
    await prisma.auditLog.create({
      data: {
        tenantId: item.tenantId,
        brandId: item.brandId,
        event,
        actorKind: ActorKind.human,
        actorUserId: opts.reviewerUserId ?? null,
        targetType: "moderation_decision",
        targetId: decision.id,
        metadata: { action: opts.action, seeded: true },
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
