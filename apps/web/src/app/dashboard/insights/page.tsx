import Link from "next/link";
import { PLATFORM_META, Platform, RiskLevel, Sentiment } from "@guardora/core";
import { PageHeader, Card, SectionHeader, StatCard, Badge, EmptyState, Tabs } from "@/components/dashboard/ui";
import { TrendChart, BarList } from "@/components/dashboard/trend-chart";
import { PlatformBreakdown } from "@/components/dashboard/platform-icon";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { humanize } from "@/lib/format";
import { bucketByDay } from "@/lib/trend";
import { RISK_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/insights");

const TABS = ["overview", "sentiment", "emotions", "posts", "topics"] as const;
const TAB_LABEL: Record<string, string> = {
  overview: "Overview",
  sentiment: "Sentiment",
  emotions: "Emotions",
  posts: "Posts",
  topics: "Topics",
};

type Where = { tenantId: string };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = sp.tab && TABS.includes(sp.tab as (typeof TABS)[number]) ? sp.tab : "overview";
  const where = { tenantId: session.tenantId };
  const tabs = TABS.map((t) => ({ key: t, label: TAB_LABEL[t]!, href: `/dashboard/insights?tab=${t}` }));

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />
      <Tabs active={tab} tabs={tabs} />
      {tab === "overview" ? <Overview where={where} /> : null}
      {tab === "sentiment" ? <SentimentTab where={where} /> : null}
      {tab === "emotions" ? <EmotionsTab where={where} /> : null}
      {tab === "posts" ? <PostsTab where={where} /> : null}
      {tab === "topics" ? <TopicsTab where={where} /> : null}
    </>
  );
}

const connectCta = (
  <Link href="/dashboard/accounts" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)]">
    Connect an account
  </Link>
);

/* ---------------------------------------------------------------- Overview */
async function Overview({ where }: { where: Where }) {
  const [total, sentiments, risky, byPlatform] = await Promise.all([
    prisma.reputationItem.count({ where }),
    prisma.reputationItem.groupBy({ by: ["sentiment"], where, _count: true }),
    prisma.reputationItem.count({ where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] } } }),
    prisma.reputationItem.groupBy({ by: ["platform"], where, _count: true }),
  ]);
  if (total === 0) {
    return <EmptyState title="No insights yet" body="Once items are ingested, Guardora surfaces sentiment, risk trends, topics, and the most risky posts here." action={connectCta} />;
  }
  const sentMap = new Map(sentiments.map((s) => [s.sentiment, s._count as unknown as number]));
  const pos = sentMap.get(Sentiment.Positive) ?? 0;
  const neg = sentMap.get(Sentiment.Negative) ?? 0;
  const neu = sentMap.get(Sentiment.Neutral) ?? 0;
  const score = total > 0 ? Math.round(((pos - neg) / total) * 100) : 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sentiment score" value={`${score > 0 ? "+" : ""}${score}`} tone={score >= 0 ? "ok" : "danger"} hint={`${pos} positive · ${neg} negative · ${neu} neutral`} />
        <StatCard label="Risk trend" value={String(risky)} tone="danger" hint="High or critical items" />
        <StatCard label="Items analyzed" value={String(total)} tone="brand" hint="All time" />
      </div>
      <div className="mt-6">
        <Card>
          <SectionHeader title="Platform breakdown" />
          <PlatformBreakdown rows={byPlatform.map((p) => ({ platform: p.platform as string, label: PLATFORM_META[p.platform as Platform].label, value: p._count as unknown as number })).sort((a, b) => b.value - a.value)} />
        </Card>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- Sentiment */
async function SentimentTab({ where }: { where: Where }) {
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
    return <EmptyState title="No sentiment data yet" body="Sentiment is scored as content is ingested and classified." action={connectCta} />;
  }
  const score = Math.round(((pos - neg) / total) * 100);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sentiment score" value={`${score > 0 ? "+" : ""}${score}`} tone={score >= 0 ? "ok" : "danger"} hint="Positive minus negative" />
        <StatCard label="Positive" value={String(pos)} tone="ok" />
        <StatCard label="Negative" value={String(neg)} tone="danger" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Breakdown" />
          <BarList rows={[{ label: "Positive", value: pos, tone: "ok" }, { label: "Neutral", value: neu, tone: "neutral" }, { label: "Negative", value: neg, tone: "danger" }]} />
        </Card>
        <Card>
          <SectionHeader title="Negative sentiment — last 30 days" />
          {negRows.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-muted)]">No negative items in this window.</p> : <TrendChart buckets={bucketByDay(negRows.map((r) => r.createdAt), 30)} />}
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
  const items = await prisma.reputationItem.findMany({ where, select: { riskCategories: true }, take: 1000 });
  if (items.length === 0) {
    return <EmptyState title="No emotion signals yet" body="Emotions are derived from the AI risk categories and sentiment on incoming content." action={connectCta} />;
  }
  const counts = new Map<string, number>([["Anger", 0], ["Anxiety", 0], ["Sadness", 0], ["Happiness", 0], ["Warmth", 0]]);
  for (const it of items) for (const c of it.riskCategories) {
    const emo = EMOTION_MAP[c];
    if (emo) counts.set(emo, (counts.get(emo) ?? 0) + 1);
  }
  const rows = [...counts.entries()].map(([label, value]) => ({ label, value, tone: EMOTION_TONE[label] }));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => (
          <StatCard key={r.label} label={r.label} value={String(r.value)} tone={(r.tone as "ok") ?? "neutral"} />
        ))}
      </div>
      <div className="mt-6">
        <Card>
          <SectionHeader title="Emotion distribution" description="Derived from AI risk categories & sentiment — not a clinical measure." />
          <BarList rows={rows} />
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Posts */
async function PostsTab({ where }: { where: Where }) {
  const items = await prisma.reputationItem.findMany({
    where,
    select: { riskLevel: true, platform: true, contentItem: { select: { externalParentId: true, permalink: true } } },
    take: 1000,
  });
  if (items.length === 0) {
    return <EmptyState title="No posts yet" body="As comments are ingested, Guardora groups them by the post they belong to and surfaces the riskiest." action={connectCta} />;
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
      <SectionHeader title="Posts by risk" description="Grouped by the post each comment belongs to" />
      <ul className="divide-y divide-[var(--color-border)]">
        {top.map(([key, p]) => (
          <li key={key} className="flex items-center gap-3 py-3">
            <Badge tone={RISK_TONE[p.maxRisk as RiskLevel] ?? "neutral"}>{humanize(p.maxRisk)}</Badge>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{key.includes(":ungrouped") ? "Ungrouped comments" : `Post ${key.slice(0, 18)}…`}</span>
              <span className="text-xs text-[var(--color-muted)]">{PLATFORM_META[p.platform as Platform].label}</span>
            </span>
            <span className="shrink-0 text-xs text-[var(--color-muted)]">{p.count} comment{p.count === 1 ? "" : "s"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ----------------------------------------------------------------- Topics */
async function TopicsTab({ where }: { where: Where }) {
  const items = await prisma.reputationItem.findMany({ where, select: { riskCategories: true }, take: 1000 });
  const counts = new Map<string, number>();
  for (const it of items) for (const c of it.riskCategories) counts.set(c, (counts.get(c) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, value]) => ({ label: humanize(label), value }));
  if (rows.length === 0) {
    return <EmptyState title="No topics yet" body="Topics are clustered from the AI risk categories assigned to incoming content." action={connectCta} />;
  }
  return (
    <Card>
      <SectionHeader title="Top topics" description="Most frequent risk categories across your content" />
      <BarList rows={rows} />
    </Card>
  );
}
