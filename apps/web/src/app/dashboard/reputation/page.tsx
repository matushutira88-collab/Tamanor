import Link from "next/link";
import { sentimentBucket, topicOf, type SentimentBucket, type ReputationTopic } from "@guardora/ai";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { withTenant } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

const RANGES = { today: 1, "7d": 7, "30d": 30 } as const;
type RangeKey = keyof typeof RANGES;

export default async function ReputationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const session = await requireSession();
  const sp = await searchParams;
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };

  const range: RangeKey = (["today", "7d", "30d"] as const).includes(sp.range as RangeKey) ? (sp.range as RangeKey) : "7d";
  const days = RANGES[range];
  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(dayStart); rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));
  const prevStart = new Date(rangeStart); prevStart.setUTCDate(prevStart.getUTCDate() - days);

  const HIDE_REASONS = ["live_hide_executed", "already_hidden"];
  // V1.37.3 — all reads run under the RLS runtime client (tamanor_app) in one
  // tenant transaction. Explicit tenantId filters stay as defense-in-depth.
  const { repItems, pendingApprovals, hides, prevRepItems, queueRows } = await withTenant(
    session.tenantId,
    async (db) => {
      const [repItems, pendingApprovals, hides, prevRepItems] = await Promise.all([
        db.reputationItem.findMany({
          where: { ...where, createdAt: { gte: rangeStart } },
          select: { id: true, riskLevel: true, riskCategories: true, sentiment: true, createdAt: true, contentItem: { select: { text: true, externalParentId: true, connectedAccount: { select: { externalName: true } } } } },
          take: 2000,
        }),
        db.actionQueueItem.count({ where: { ...where, queueState: "approval_required" } }),
        db.platformActionExecution.findMany({ where: { ...where, status: "executed", reason: { in: HIDE_REASONS }, executedAt: { gte: rangeStart } }, select: { trigger: true, externalPostId: true, executedAt: true } }),
        db.reputationItem.findMany({ where: { ...where, createdAt: { gte: prevStart, lt: rangeStart } }, select: { riskLevel: true, riskCategories: true, sentiment: true } }),
      ]);
      const queueRows = await db.actionQueueItem.findMany({ where: { ...where, itemId: { in: repItems.map((r) => r.id) } }, select: { itemId: true, queueState: true } });
      return { repItems, pendingApprovals, hides, prevRepItems, queueRows };
    },
  );

  // itemId → queueState (for per-post pending + risky-post aggregation).
  const queueMap = new Map<string, string>(queueRows.map((q) => [q.itemId, q.queueState]));

  // --- Sentiment buckets (state-truth aware) ---
  const buckets: Record<SentimentBucket, number> = { positive: 0, neutral: 0, negative: 0, risky: 0 };
  const topics = new Map<ReputationTopic, number>();
  const posts = new Map<string, { total: number; risky: number; pending: number; snippet: string; account: string }>();
  // Criticism vs harmful split.
  const split = { legit: 0, questions: 0, complaints: 0, hate: 0, spamScam: 0, threats: 0 };

  for (const r of repItems) {
    const cats = r.riskCategories ?? [];
    const b = sentimentBucket({ categories: cats, sentiment: r.sentiment as string, riskLevel: r.riskLevel as string });
    buckets[b]++;
    const topic = topicOf(cats, r.contentItem.text);
    topics.set(topic, (topics.get(topic) ?? 0) + 1);

    // criticism vs harmful
    if (cats.includes("customer_question")) split.questions++;
    else if (cats.some((c) => ["refund_complaint", "legal_complaint", "safety_claim"].includes(c))) split.complaints++;
    else if (cats.some((c) => ["threat", "violence", "terrorism_extremism", "coordinated_attack", "crisis_keyword"].includes(c))) split.threats++;
    else if (cats.some((c) => ["spam", "scam", "phishing"].includes(c))) split.spamScam++;
    else if (cats.some((c) => ["profanity", "personal_attack", "hate_speech", "racism", "sexual_vulgarity"].includes(c))) split.hate++;
    else if (b === "negative") split.legit++;

    // risky posts
    const pid = r.contentItem.externalParentId ?? "none";
    const p = posts.get(pid) ?? { total: 0, risky: 0, pending: 0, snippet: r.contentItem.text.slice(0, 60), account: r.contentItem.connectedAccount?.externalName ?? "—" };
    p.total++;
    if (b === "risky") p.risky++;
    if (queueMap.get(r.id) === "approval_required") p.pending++;
    posts.set(pid, p);
  }

  const total = repItems.length;
  const riskyCount = buckets.risky;
  const hiddenCount = hides.length;
  const autoHidden = hides.filter((h) => h.trigger === "autonomous").length;
  const positivePct = total > 0 ? Math.round((buckets.positive / total) * 100) : 0;
  const sentimentLabel = total === 0 ? "—"
    : buckets.positive >= buckets.negative && buckets.positive >= buckets.neutral ? `${positivePct}% ${t.rep.sentPositiveLow}`
    : buckets.negative > buckets.neutral ? t.rep.sentMostlyNegative : t.rep.sentMostlyNeutral;

  // hidden per post (from executions, no raw id exposed).
  const hidesByPost = new Map<string, number>();
  for (const h of hides) { const k = h.externalPostId ?? "none"; hidesByPost.set(k, (hidesByPost.get(k) ?? 0) + 1); }

  const topPosts = [...posts.entries()]
    .map(([pid, p]) => ({ pid, ...p, hidden: hidesByPost.get(pid) ?? 0 }))
    .filter((p) => p.risky > 0 || p.hidden > 0 || p.pending > 0)
    .sort((a, b) => b.risky - a.risky || b.hidden - a.hidden || b.pending - a.pending || b.total - a.total)
    .slice(0, 5);

  const topTopics = [...topics.entries()].filter(([topic]) => topic !== "uncategorized").sort((a, b) => b[1] - a[1]).slice(0, 6);

  // --- Risk trend by day ---
  const dayKeys: { key: string; label: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(rangeStart); d.setUTCDate(d.getUTCDate() + i);
    dayKeys.push({ key: d.toISOString().slice(0, 10), label: `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}` });
  }
  const riskyByDay = new Map<string, number>();
  const hiddenByDay = new Map<string, number>();
  for (const r of repItems) {
    if (sentimentBucket({ categories: r.riskCategories ?? [], sentiment: r.sentiment as string, riskLevel: r.riskLevel as string }) === "risky") {
      const k = r.createdAt.toISOString().slice(0, 10);
      riskyByDay.set(k, (riskyByDay.get(k) ?? 0) + 1);
    }
  }
  for (const h of hides) { if (h.executedAt) { const k = h.executedAt.toISOString().slice(0, 10); hiddenByDay.set(k, (hiddenByDay.get(k) ?? 0) + 1); } }
  const maxDay = Math.max(1, ...dayKeys.map((d) => Math.max(riskyByDay.get(d.key) ?? 0, hiddenByDay.get(d.key) ?? 0)));

  // --- Recommendations ---
  const prevRisky = prevRepItems.filter((r) => sentimentBucket({ categories: r.riskCategories ?? [], sentiment: r.sentiment as string, riskLevel: r.riskLevel as string }) === "risky").length;
  const scamCount = repItems.filter((r) => (r.riskCategories ?? []).some((c) => ["scam", "phishing"].includes(c))).length;
  const recs: string[] = [];
  if (riskyCount > prevRisky && prevRisky >= 0 && riskyCount > 0) recs.push(t.rep.recRiskUp);
  if (scamCount >= 3) recs.push(t.rep.recScam);
  if (pendingApprovals >= 3) recs.push(t.rep.recPending);
  if (split.complaints + split.legit >= 4) recs.push(t.rep.recComplaints);
  if (recs.length === 0) recs.push(t.rep.recStable);

  // --- Summary ---
  const topTopicNames = topTopics.slice(0, 3).map(([tp]) => t.rep[`topic_${tp}` as "topic_price"]).join(", ") || "—";
  const summary = total === 0 ? t.rep.emptyNoComments
    : t.rep.summaryTemplate
        .replace("{days}", String(days)).replace("{total}", String(total)).replace("{risky}", String(riskyCount))
        .replace("{hidden}", String(hiddenCount)).replace("{pending}", String(pendingApprovals)).replace("{topics}", topTopicNames);

  const RangeTab = ({ k, label }: { k: RangeKey; label: string }) => (
    <Link href={`/dashboard/reputation${k === "7d" ? "" : `?range=${k}`}`}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${range === k ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`}>{label}</Link>
  );

  return (
    <>
      <PageHeader eyebrow={t.rep.eyebrow} title={t.rep.title} description={t.rep.subtitle} />

      {/* C) Date range */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <RangeTab k="today" label={t.rep.rangeToday} />
        <RangeTab k="7d" label={t.rep.range7d} />
        <RangeTab k="30d" label={t.rep.range30d} />
      </div>

      {total === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-muted)]">{t.rep.emptyNoComments}</Card>
      ) : (
        <>
          {/* D) Metric cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.rep.sentiment}</p><p className="mt-1 text-lg font-bold">{sentimentLabel}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.rep.riskyComments}</p><p className="mt-1 text-2xl font-bold">{riskyCount}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.rep.hiddenPublic}</p><p className="mt-1 text-2xl font-bold">{hiddenCount}</p><p className="text-[11px] text-[var(--color-muted)]">{autoHidden} {t.rep.autoSuffix}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.rep.pendingDecision}</p><p className="mt-1 text-2xl font-bold">{pendingApprovals}</p></Card>
          </div>

          {/* Actor Risk preview link (V1.30) */}
          <Link href="/dashboard/actor-risk" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm hover:border-[var(--color-border-strong)]">
            <span>{t.rep.actorRiskLink}</span>
            <span className="shrink-0 text-xs font-medium text-[var(--color-brand)]">{t.rep.actorRiskLinkCta} →</span>
          </Link>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* E) Sentiment breakdown */}
            <Card>
              <h3 className="mb-2 text-sm font-semibold">{t.rep.sentimentBreakdown}</h3>
              <p className="mb-3 text-xs text-[var(--color-muted)]">{t.rep.riskyNote}</p>
              {([["positive", buckets.positive, "ok"], ["neutral", buckets.neutral, "neutral"], ["negative", buckets.negative, "warn"], ["risky", buckets.risky, "danger"]] as const).map(([k, n, tone]) => (
                <Link key={k} href={`/dashboard/comments?filter=${k}`} className="mb-2 block hover:opacity-80">
                  <div className="mb-0.5 flex justify-between text-xs"><span>{t.rep[`bucket_${k}` as "bucket_positive"]}</span><span className="font-medium">{n}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]"><div className={`h-full rounded-full ${tone === "ok" ? "bg-[var(--color-ok)]" : tone === "danger" ? "bg-[var(--color-danger)]" : tone === "warn" ? "bg-[var(--color-warn)]" : "bg-[var(--color-muted)]"}`} style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} /></div>
                </Link>
              ))}
            </Card>

            {/* F) Risk over time */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">{t.rep.riskOverTime}</h3>
              <div className="flex items-end gap-1 overflow-x-hidden" style={{ height: 96 }}>
                {dayKeys.map((d) => {
                  const rv = riskyByDay.get(d.key) ?? 0; const hv = hiddenByDay.get(d.key) ?? 0;
                  return (
                    <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5" title={`${d.label}: ${rv} / ${hv}`}>
                      <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 72 }}>
                        <div className="w-1.5 rounded-t bg-[var(--color-danger)]" style={{ height: `${(rv / maxDay) * 100}%` }} />
                        <div className="w-1.5 rounded-t bg-[var(--color-warn)]" style={{ height: `${(hv / maxDay) * 100}%` }} />
                      </div>
                      {days <= 7 ? <span className="text-[9px] text-[var(--color-muted)]">{d.label}</span> : null}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-[var(--color-muted)]"><span className="text-[var(--color-danger)]">■</span> {t.rep.riskyComments} · <span className="text-[var(--color-warn)]">■</span> {t.rep.hiddenPublic}</p>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* G) Top topics */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">{t.rep.topTopics}</h3>
              {topTopics.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{t.rep.emptyTopics}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {topTopics.map(([topic, n]) => (
                    <li key={topic} className="flex items-center justify-between"><span>{t.rep[`topic_${topic}` as "topic_price"]}</span><span className="text-[var(--color-muted)]">{n} {t.rep.commentsWord}</span></li>
                  ))}
                </ul>
              )}
            </Card>

            {/* I) Criticism vs harmful content */}
            <Card>
              <h3 className="mb-2 text-sm font-semibold">{t.rep.critVsHarmful}</h3>
              <p className="mb-3 text-xs text-[var(--color-muted)]">{t.rep.critNote}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-[var(--color-border)] p-2"><p className="text-lg font-bold">{split.legit}</p><p className="text-xs text-[var(--color-muted)]">{t.rep.critLegit}</p></div>
                <div className="rounded-lg border border-[var(--color-border)] p-2"><p className="text-lg font-bold">{split.questions}</p><p className="text-xs text-[var(--color-muted)]">{t.rep.critQuestions}</p></div>
                <div className="rounded-lg border border-[var(--color-border)] p-2"><p className="text-lg font-bold">{split.complaints}</p><p className="text-xs text-[var(--color-muted)]">{t.rep.critComplaints}</p></div>
                <div className="rounded-lg border border-[var(--color-danger)] p-2"><p className="text-lg font-bold">{split.hate}</p><p className="text-xs text-[var(--color-muted)]">{t.rep.critHate}</p></div>
                <div className="rounded-lg border border-[var(--color-danger)] p-2"><p className="text-lg font-bold">{split.spamScam}</p><p className="text-xs text-[var(--color-muted)]">{t.rep.critSpamScam}</p></div>
                <div className="rounded-lg border border-[var(--color-danger)] p-2"><p className="text-lg font-bold">{split.threats}</p><p className="text-xs text-[var(--color-muted)]">{t.rep.critThreats}</p></div>
              </div>
            </Card>
          </div>

          {/* H) Top risky posts */}
          <Card className="mt-5">
            <h3 className="mb-3 text-sm font-semibold">{t.rep.riskiestPosts}</h3>
            {topPosts.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t.rep.emptyRiskyPosts}</p>
            ) : (
              <ul className="space-y-2">
                {topPosts.map((p) => (
                  <li key={p.pid} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] p-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">“{p.snippet}…”</p>
                      <p className="text-xs text-[var(--color-muted)]">Facebook · {p.account} · {p.total} {t.rep.commentsWord} · <span className="text-[var(--color-danger)]">{p.risky} {t.rep.riskyWord}</span> · {p.hidden} {t.rep.hiddenWord} · {p.pending} {t.rep.pendingWord}</p>
                    </div>
                    <Link href="/dashboard/action-queue" className="shrink-0 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.rep.openInQueue}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* J) Recommendations */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">💡 {t.rep.recommendations}</h3>
              <ul className="space-y-2 text-sm">
                {recs.map((r, i) => (<li key={i} className="rounded-lg border border-[var(--color-border)] p-2">{r}</li>))}
              </ul>
            </Card>

            {/* K) Reputation summary */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">{t.rep.reputationSummary}</h3>
              <p className="text-sm leading-relaxed">{summary}</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
