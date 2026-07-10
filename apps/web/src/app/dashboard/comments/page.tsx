import Link from "next/link";
import {
  buildActorSignals, actorRiskScore, actorRiskLevel, sentimentBucket,
  type ActorComment, type ActorRiskLevel, type SentimentBucket,
} from "@guardora/ai";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const RANGES = { today: 1, "7d": 7, "30d": 30 } as const;
type RangeKey = keyof typeof RANGES;
type FilterKey = "all" | "positive" | "neutral" | "negative" | "risky" | "hidden" | "pending";
const FILTERS: FilterKey[] = ["all", "positive", "neutral", "negative", "risky", "hidden", "pending"];

const HIDE_REASONS = ["live_hide_executed", "already_hidden"];
const BUCKET_TONE: Record<SentimentBucket, "ok" | "neutral" | "warn" | "danger"> = { positive: "ok", neutral: "neutral", negative: "warn", risky: "danger" };

interface Row {
  id: string; text: string; author: string; authorKey: string | null; platform: string; account: string;
  permalink: string | null; createdAt: Date; bucket: SentimentBucket; riskLevel: string; category: string | null;
  statusKey: string; hiddenPublic: boolean; pending: boolean; resolved: boolean; queueItemId: string | null; actorLevel: ActorRiskLevel | null;
}

export default async function CommentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const session = await requireSession();
  const sp = await searchParams;
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };
  const rel = { justNow: t.cc.relJustNow, minAgo: t.cc.relMinAgo, today: t.cc.relToday };

  const range: RangeKey = (["today", "7d", "30d"] as const).includes(sp.range as RangeKey) ? (sp.range as RangeKey) : "7d";
  const filter: FilterKey = (FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as FilterKey) : "all";
  const q = (sp.q ?? "").trim();
  const days = RANGES[range];
  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(dayStart); rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));

  const [repItems, executions, queueItems, accountCount] = await Promise.all([
    prisma.reputationItem.findMany({
      where: { ...where, createdAt: { gte: rangeStart } },
      select: {
        id: true, riskLevel: true, riskCategories: true, sentiment: true, createdAt: true,
        contentItem: { select: { text: true, externalId: true, externalParentId: true, permalink: true, authorDisplayName: true, authorExternalId: true, platform: true, connectedAccount: { select: { externalName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.platformActionExecution.findMany({ where: { ...where, status: "executed", reason: { in: [...HIDE_REASONS, "comment_deleted", "facebook_can_hide_false"] }, executedAt: { gte: rangeStart } }, select: { externalCommentId: true, reason: true } }),
    prisma.actionQueueItem.findMany({ where, select: { id: true, itemId: true, queueState: true } }),
    prisma.connectedAccount.count({ where }),
  ]);

  // External-comment-id → terminal state (state truth; deleted wins over hidden wins over can_hide_false).
  const execState = new Map<string, "deleted" | "hidden" | "cannot_hide">();
  for (const e of executions) {
    if (!e.externalCommentId) continue;
    const prev = execState.get(e.externalCommentId);
    const next = e.reason === "comment_deleted" ? "deleted" : HIDE_REASONS.includes(e.reason ?? "") ? "hidden" : "cannot_hide";
    if (prev === "deleted" || (prev === "hidden" && next === "cannot_hide")) continue;
    execState.set(e.externalCommentId, next);
  }
  const queueByItem = new Map(queueItems.map((qi) => [qi.itemId, qi]));

  // Per-author risk level (medium+), reusing the Actor Risk scoring — no extra query.
  const authorComments = new Map<string, ActorComment[]>();
  for (const r of repItems) {
    const ci = r.contentItem;
    const key = ci.authorExternalId ? `id:${ci.authorExternalId}` : ci.authorDisplayName ? `name:${ci.authorDisplayName}` : null;
    if (!key) continue;
    (authorComments.get(key) ?? authorComments.set(key, []).get(key)!).push({ categories: r.riskCategories ?? [], riskLevel: r.riskLevel as string, sentiment: r.sentiment as string, postId: ci.externalParentId ?? null, text: ci.text, hidden: ci.externalId ? execState.get(ci.externalId) === "hidden" : false });
  }
  const authorLevel = new Map<string, ActorRiskLevel>();
  for (const [key, comments] of authorComments) {
    const level = actorRiskLevel(actorRiskScore(buildActorSignals(comments)));
    if (level !== "low") authorLevel.set(key, level);
  }

  // Build display rows.
  const rows: Row[] = repItems.map((r) => {
    const ci = r.contentItem;
    const cats = r.riskCategories ?? [];
    const bucket = sentimentBucket({ categories: cats, sentiment: r.sentiment as string, riskLevel: r.riskLevel as string });
    const st = ci.externalId ? execState.get(ci.externalId) : undefined;
    const qi = queueByItem.get(r.id);
    const hiddenPublic = st === "hidden";
    const resolved = st === "deleted";
    const pending = qi?.queueState === "approval_required";
    const statusKey = resolved ? "st_deleted"
      : hiddenPublic ? "st_hidden"
      : st === "cannot_hide" ? "st_canHideFalse"
      : pending ? "st_pending"
      : qi?.queueState === "monitor" ? "st_monitored"
      : qi?.queueState === "no_action" ? "st_noAction"
      : cats.includes("normal_criticism") ? "st_kept"
      : "st_captured";
    const key = ci.authorExternalId ? `id:${ci.authorExternalId}` : ci.authorDisplayName ? `name:${ci.authorDisplayName}` : null;
    return {
      id: r.id, text: ci.text, author: ci.authorDisplayName ?? t.comments.unknownAuthor, authorKey: key,
      platform: ci.platform, account: ci.connectedAccount?.externalName ?? "—", permalink: ci.permalink,
      createdAt: r.createdAt, bucket, riskLevel: r.riskLevel as string, category: cats[0] ?? null,
      statusKey, hiddenPublic, pending, resolved, queueItemId: qi?.id ?? null, actorLevel: key ? authorLevel.get(key) ?? null : null,
    };
  });

  // Metric cards — over the full range (before filter/search).
  const mAll = rows.length;
  const mPositive = rows.filter((r) => r.bucket === "positive" || r.bucket === "neutral").length;
  const mNegative = rows.filter((r) => r.bucket === "negative").length;
  const mRiskyHidden = rows.filter((r) => r.bucket === "risky" || r.hiddenPublic).length;

  // Apply filter + search.
  const ql = q.toLowerCase();
  const shown = rows.filter((r) => {
    const matchFilter = filter === "all" ? true
      : filter === "hidden" ? r.hiddenPublic
      : filter === "pending" ? r.pending
      : r.bucket === filter;
    if (!matchFilter) return false;
    if (!ql) return true;
    return r.text.toLowerCase().includes(ql) || r.author.toLowerCase().includes(ql) || (r.category ?? "").toLowerCase().includes(ql) || tEnum(t, "autoProtectCategory", r.category ?? "").toLowerCase().includes(ql);
  });

  const params = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const rg = over.range ?? (range !== "7d" ? range : undefined);
    const fl = over.filter ?? (filter !== "all" ? filter : undefined);
    const qq = over.q ?? (q || undefined);
    if (rg && rg !== "7d") p.set("range", rg);
    if (fl && fl !== "all") p.set("filter", fl);
    if (qq) p.set("q", qq);
    const s = p.toString();
    return `/dashboard/comments${s ? `?${s}` : ""}`;
  };
  const chipCls = (active: boolean) => `rounded-md border px-3 py-1.5 text-xs font-medium ${active ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`;
  const FILTER_LABEL: Record<FilterKey, string> = { all: t.comments.fAll, positive: t.comments.fPositive, neutral: t.comments.fNeutral, negative: t.comments.fNegative, risky: t.comments.fRisky, hidden: t.comments.fHidden, pending: t.comments.fPending };

  return (
    <>
      <PageHeader eyebrow={t.comments.eyebrow} title={t.comments.title} description={t.comments.subtitle} />
      <p className="-mt-2 mb-4 text-xs text-[var(--color-muted)]">{t.comments.secondary}</p>

      {accountCount === 0 ? (
        <Card className="p-6">
          <p className="text-sm font-medium">{t.comments.emptyNoAccount}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.comments.emptyNoAccountBody}</p>
          <Link href="/dashboard/accounts" className="mt-3 inline-block rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.comments.account} →</Link>
        </Card>
      ) : mAll === 0 ? (
        <Card className="p-6">
          <p className="text-sm font-medium">{t.comments.emptyNoComments}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.comments.emptyNoCommentsBody}</p>
        </Card>
      ) : (
        <>
          {/* Date range */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            <Link href={params({ range: "today" })} className={chipCls(range === "today")}>{t.comments.rangeToday}</Link>
            <Link href={params({ range: "7d" })} className={chipCls(range === "7d")}>{t.comments.range7d}</Link>
            <Link href={params({ range: "30d" })} className={chipCls(range === "30d")}>{t.comments.range30d}</Link>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mAll}</p><p className="mt-1 text-2xl font-bold">{mAll}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mPositive}</p><p className="mt-1 text-2xl font-bold">{mPositive}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mNegative}</p><p className="mt-1 text-2xl font-bold">{mNegative}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mRiskyHidden}</p><p className="mt-1 text-2xl font-bold">{mRiskyHidden}</p></Card>
          </div>

          {/* Search */}
          <form className="mt-4 flex gap-2" action="/dashboard/comments">
            {range !== "7d" ? <input type="hidden" name="range" value={range} /> : null}
            {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
            <input name="q" defaultValue={q} placeholder={t.comments.searchPlaceholder} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]" />
            {q ? <Link href={params({ q: "" })} className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.searchClear}</Link> : null}
          </form>

          {/* Filter chips */}
          <div className="mt-3 mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (<Link key={f} href={params({ filter: f, q })} className={chipCls(filter === f)}>{FILTER_LABEL[f]}</Link>))}
          </div>

          {shown.length === 0 ? (
            <Card className="p-6 text-sm text-[var(--color-muted)]">{q ? t.comments.emptySearch : t.comments.emptyFilter}</Card>
          ) : (
            <div className="space-y-3">
              {shown.map((r) => (
                <Card key={r.id} className="p-0">
                  <details className="group">
                    <summary className="flex cursor-pointer flex-col gap-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={BUCKET_TONE[r.bucket]}>{t.rep[`bucket_${r.bucket}` as "bucket_positive"]}</Badge>
                        {r.category ? <Badge tone="neutral">{tEnum(t, "autoProtectCategory", r.category)}</Badge> : null}
                        {r.hiddenPublic ? <Badge tone="warn">{t.comments.hiddenPublic}</Badge> : null}
                        {r.pending ? <Badge tone="neutral">{t.comments.pendingDecision}</Badge> : null}
                        {r.actorLevel ? <Link href="/dashboard/actor-risk"><Badge tone={r.actorLevel === "medium" ? "warn" : "danger"}>{t.actor.badgePrefix}: {t.actor[`level_${r.actorLevel}` as "level_medium"]}</Badge></Link> : null}
                      </div>
                      <p className="text-sm">{r.text}</p>
                      <p className="text-xs text-[var(--color-muted)]">{r.author} · {r.platform} · {r.account} · {relativeTime(r.createdAt, rel, now)} · {t.comments[r.statusKey as "st_captured"]}</p>
                    </summary>

                    <div className="border-t border-[var(--color-border)] p-4 text-sm">
                      <p className="mb-3 whitespace-pre-wrap">{r.text}</p>
                      <dl className="space-y-1.5 text-xs">
                        <Row2 label={t.comments.author}>{r.author}</Row2>
                        <Row2 label={t.comments.platform}>{r.platform}</Row2>
                        <Row2 label={t.comments.account}>{r.account}</Row2>
                        <Row2 label={t.comments.sentiment}>{t.rep[`bucket_${r.bucket}` as "bucket_positive"]}</Row2>
                        <Row2 label={t.comments.risk}>{tEnum(t, "risk", r.riskLevel)}{r.category ? ` · ${tEnum(t, "autoProtectCategory", r.category)}` : ""}</Row2>
                        <Row2 label={t.comments.status}>{t.comments[r.statusKey as "st_captured"]}</Row2>
                        {r.permalink ? <Row2 label={t.comments.post}><a href={r.permalink} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand)] hover:underline">{t.comments.post} →</a></Row2> : null}
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {r.queueItemId ? <Link href={`/dashboard/action-queue/${r.queueItemId}`} className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openInQueue}</Link> : null}
                        {r.actorLevel ? <Link href="/dashboard/actor-risk" className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openActor}</Link> : null}
                        <Link href="/dashboard/reputation" className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openReputation}</Link>
                      </div>
                    </div>
                  </details>
                </Card>
              ))}
            </div>
          )}

          <p className="mt-5 text-xs text-[var(--color-muted)]">{t.comments.trustNote}</p>
        </>
      )}
    </>
  );
}

function Row2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--color-border)] py-1 last:border-0">
      <span className="text-[var(--color-muted)]">{label}</span><span className="text-right font-medium">{children}</span>
    </div>
  );
}
