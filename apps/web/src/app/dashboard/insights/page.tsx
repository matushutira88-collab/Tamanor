import Link from "next/link";
import { PLATFORM_META, Platform, RiskLevel, Sentiment } from "@guardora/core";
import { PageHeader, Card, SectionHeader, StatCard, Badge, EmptyState, Tabs } from "@/components/dashboard/ui";
import { TrendChart, BarList } from "@/components/dashboard/trend-chart";
import { PlatformBreakdown } from "@/components/dashboard/platform-icon";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { withEmoji, enumEmoji } from "@/lib/enum-emoji";
import { bucketByDay } from "@/lib/trend";
import { RISK_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/insights");

const TABS = ["overview", "sentiment", "emotions", "posts", "topics"] as const;

type Where = { tenantId: string };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const hdrT = await getT();
  const sp = await searchParams;
  const tab = sp.tab && TABS.includes(sp.tab as (typeof TABS)[number]) ? sp.tab : "overview";
  const where = { tenantId: session.tenantId };
  const TAB_LABEL: Record<string, string> = {
    overview: hdrT.dash.overview,
    sentiment: hdrT.dash.sentiment,
    emotions: hdrT.dash.emotionsTab,
    posts: hdrT.dash.postsTab,
    topics: hdrT.dash.topicsTab,
  };
  const tabs = TABS.map((t) => ({ key: t, label: TAB_LABEL[t]!, href: `/dashboard/insights?tab=${t}` }));

  return (
    <>
      <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={hdrT.dashHeaders[nav.icon].desc} />
      <Tabs active={tab} tabs={tabs} />
      {tab === "overview" ? <Overview where={where} /> : null}
      {tab === "sentiment" ? <SentimentTab where={where} /> : null}
      {tab === "emotions" ? <EmotionsTab where={where} /> : null}
      {tab === "posts" ? <PostsTab where={where} /> : null}
      {tab === "topics" ? <TopicsTab where={where} /> : null}
    </>
  );
}

const cta = (label: string) => (
  <Link href="/dashboard/accounts" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)]">
    {label}
  </Link>
);

/* ---------------------------------------------------------------- Overview */
async function Overview({ where }: { where: Where }) {
  const t = await getT();
  const [total, sentiments, risky, byPlatform] = await Promise.all([
    prisma.reputationItem.count({ where }),
    prisma.reputationItem.groupBy({ by: ["sentiment"], where, _count: true }),
    prisma.reputationItem.count({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] } } }),
    prisma.reputationItem.groupBy({ by: ["platform"], where, _count: true }),
  ]);
  if (total === 0) {
    return <EmptyState title={t.dash.noInsights} body={t.dash.noInsightsBody} action={cta(t.dash.connectAccount)} />;
  }
  const sentMap = new Map(sentiments.map((s) => [s.sentiment, s._count as unknown as number]));
  const pos = sentMap.get(Sentiment.Positive) ?? 0;
  const neg = sentMap.get(Sentiment.Negative) ?? 0;
  const neu = sentMap.get(Sentiment.Neutral) ?? 0;
  const score = total > 0 ? Math.round(((pos - neg) / total) * 100) : 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t.dash.sentimentScore} value={`${score > 0 ? "+" : ""}${score}`} tone={score >= 0 ? "ok" : "danger"} hint={`${pos} ${t.dash.positive} · ${neg} ${t.dash.negative} · ${neu} ${t.dash.neutral}`} />
        <StatCard label={t.dash.riskTrend} value={String(risky)} tone="danger" hint={t.dash.highOrCriticalItems} />
        <StatCard label={t.dash.itemsAnalyzed} value={String(total)} tone="brand" hint={t.dash.allTime} />
      </div>
      <div className="mt-6">
        <Card>
          <SectionHeader title={t.dash.platformBreakdown} />
          <PlatformBreakdown rows={byPlatform.map((p) => ({ platform: p.platform as string, label: PLATFORM_META[p.platform as Platform].label, value: p._count as unknown as number })).sort((a, b) => b.value - a.value)} />
        </Card>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- Sentiment */
async function SentimentTab({ where }: { where: Where }) {
  const t = await getT();
  const [groups, negRows] = await Promise.all([
    prisma.reputationItem.groupBy({ by: ["sentiment"], where, _count: true }),
    prisma.reputationItem.findMany({ where: { ...where, sentiment: Sentiment.Negative, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { createdAt: true } }),
  ]);
  const map = new Map(groups.map((g) => [g.sentiment, g._count as unknown as number]));
  const pos = map.get(Sentiment.Positive) ?? 0;
  const neg = map.get(Sentiment.Negative) ?? 0;
  const neu = map.get(Sentiment.Neutral) ?? 0;
  const total = pos + neg + neu;
  if (total === 0) {
    return <EmptyState title={t.dash.noSentiment} body={t.dash.noSentimentBody} action={cta(t.dash.connectAccount)} />;
  }
  const score = Math.round(((pos - neg) / total) * 100);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t.dash.sentimentScore} value={`${score > 0 ? "+" : ""}${score}`} tone={score >= 0 ? "ok" : "danger"} hint={t.dash.positiveMinusNegative} />
        <StatCard label={t.dash.positive} value={String(pos)} tone="ok" />
        <StatCard label={t.dash.negative} value={String(neg)} tone="danger" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title={t.dash.breakdown} />
          <BarList rows={[{ label: withEmoji("sentiment", "positive", t.dash.positive), value: pos, tone: "ok" }, { label: withEmoji("sentiment", "neutral", t.dash.neutral), value: neu, tone: "neutral" }, { label: withEmoji("sentiment", "negative", t.dash.negative), value: neg, tone: "danger" }]} />
        </Card>
        <Card>
          <SectionHeader title={t.dash.negSentiment30} />
          {negRows.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-muted)]">{t.dash.noNegItemsWindow}</p> : <TrendChart buckets={bucketByDay(negRows.map((r) => r.createdAt), 30)} />}
        </Card>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Emotions */
const EMOTION_MAP: Record<string, string> = {
  harassment: "Anger", hate_speech: "Anger", brand_attack: "Anger", profanity: "Anger",
  scam: "Anxiety", legal_threat: "Anxiety", misinformation: "Anxiety", spam: "Anxiety",
  complaint: "Sadness", self_harm: "Sadness",
  positive: "Happiness",
  neutral: "Warmth",
};
const EMOTION_TONE: Record<string, string> = { Anger: "danger", Anxiety: "warn", Sadness: "brand", Happiness: "ok", Warmth: "neutral" };

async function EmotionsTab({ where }: { where: Where }) {
  const t = await getT();
  const items = await prisma.reputationItem.findMany({ where, select: { riskCategories: true }, take: 1000 });
  if (items.length === 0) {
    return <EmptyState title={t.dash.noEmotion} body={t.dash.noEmotionBody} action={cta(t.dash.connectAccount)} />;
  }
  const counts = new Map<string, number>([["Anger", 0], ["Anxiety", 0], ["Sadness", 0], ["Happiness", 0], ["Warmth", 0]]);
  for (const it of items) for (const c of it.riskCategories) {
    const emo = EMOTION_MAP[c];
    if (emo) counts.set(emo, (counts.get(emo) ?? 0) + 1);
  }
  const rows = [...counts.entries()].map(([key, value]) => ({ label: withEmoji("emotion", key, t.dash.emotions[key as keyof typeof t.dash.emotions] ?? key), value, tone: EMOTION_TONE[key] }));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => (
          <StatCard key={r.label} label={r.label} value={String(r.value)} tone={(r.tone as "ok") ?? "neutral"} />
        ))}
      </div>
      <div className="mt-6">
        <Card>
          <SectionHeader title={t.dash.emotionDistribution} description={t.dash.emotionDistDesc} />
          <BarList rows={rows} />
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Posts */
async function PostsTab({ where }: { where: Where }) {
  const t = await getT();
  const items = await prisma.reputationItem.findMany({
    where,
    select: { riskLevel: true, platform: true, contentItem: { select: { externalParentId: true, permalink: true } } },
    take: 1000,
  });
  if (items.length === 0) {
    return <EmptyState title={t.dash.noPosts} body={t.dash.noPostsBody} action={cta(t.dash.connectAccount)} />;
  }
  const RISK_WEIGHT: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const posts = new Map<string, { platform: string; count: number; maxRisk: string; permalink?: string | null }>();
  for (const it of items) {
    const key = it.contentItem.externalParentId ?? `${it.platform}:ungrouped`;
    const cur = posts.get(key) ?? { platform: it.platform, count: 0, maxRisk: "none", permalink: it.contentItem.permalink };
    cur.count += 1;
    if ((RISK_WEIGHT[it.riskLevel] ?? 0) > (RISK_WEIGHT[cur.maxRisk] ?? 0)) cur.maxRisk = it.riskLevel;
    posts.set(key, cur);
  }
  const top = [...posts.entries()].sort((a, b) => (RISK_WEIGHT[b[1].maxRisk]! - RISK_WEIGHT[a[1].maxRisk]!) || b[1].count - a[1].count).slice(0, 10);
  return (
    <Card>
      <SectionHeader title={t.dash.postsByRisk} description={t.dash.postsByRiskDesc} />
      <ul className="divide-y divide-[var(--color-border)]">
        {top.map(([key, p]) => (
          <li key={key} className="flex items-center gap-3 py-3">
            <Badge tone={RISK_TONE[p.maxRisk as RiskLevel] ?? "neutral"}>{withEmoji("risk", p.maxRisk, tEnum(t, "risk", p.maxRisk))}</Badge>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{key.includes(":ungrouped") ? t.dash.ungroupedComments : `Post ${key.slice(0, 18)}…`}</span>
              <span className="text-xs text-[var(--color-muted)]">{PLATFORM_META[p.platform as Platform].label}</span>
            </span>
            <span className="shrink-0 text-xs text-[var(--color-muted)]">{p.count} {p.count === 1 ? t.dash.comment : t.dash.comments2}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ----------------------------------------------------------------- Topics */
async function TopicsTab({ where }: { where: Where }) {
  const t = await getT();
  const items = await prisma.reputationItem.findMany({ where, select: { riskCategories: true }, take: 1000 });
  const counts = new Map<string, number>();
  for (const it of items) for (const c of it.riskCategories) counts.set(c, (counts.get(c) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, value]) => ({ label: withEmoji("category", label, tEnum(t, "category", label)), value }));
  if (rows.length === 0) {
    return <EmptyState title={t.dash.noTopics} body={t.dash.noTopicsBody} action={cta(t.dash.connectAccount)} />;
  }
  return (
    <Card>
      <SectionHeader title={t.dash.topTopics} description={t.dash.topTopicsDesc} />
      <BarList rows={rows} />
    </Card>
  );
}
