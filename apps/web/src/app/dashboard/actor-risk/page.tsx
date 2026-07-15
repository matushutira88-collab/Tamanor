import Link from "next/link";
import {
  buildActorSignals, actorRiskScore, actorRiskLevel, actorRiskReasons,
  sentimentBucket, type ActorComment, type ActorRiskLevel,
} from "@guardora/ai";
import { actorIdentityKey, platformKeyFor, PLATFORM_META, type Platform } from "@guardora/core";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { getLocale } from "@/i18n/locale-server";
import { withTenant } from "@guardora/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const RANGES = { today: 1, "7d": 7, "30d": 30 } as const;
type RangeKey = keyof typeof RANGES;
type FilterKey = "all" | "high" | "scam" | "abuse" | "multipost";
const FILTERS: FilterKey[] = ["all", "high", "scam", "abuse", "multipost"];

const HIDE_REASONS = ["live_hide_executed", "already_hidden"];
const LEVEL_TONE: Record<ActorRiskLevel, "neutral" | "warn" | "danger"> = { low: "neutral", medium: "warn", high: "danger", critical: "danger" };
// Risky categories that count toward the actor's "top risk"/abuse signals (customer-voice excluded).
const ABUSE_CATS = ["profanity", "personal_attack", "hate_speech", "racism", "threat", "violence", "terrorism_extremism", "sexual_vulgarity"];

interface Recent {
  text: string; category: string | null; riskLevel: string;
  hidden: boolean; pending: boolean; resolved: boolean; createdAt: Date;
}
interface Actor {
  key: string; display: string; platform: string; account: string;
  comments: ActorComment[]; recent: Recent[]; postIds: Set<string>;
  categoryCounts: Map<string, number>; pending: number; hidden: number; resolved: number;
  lastActivity: Date; inIncident: boolean;
}

export default async function ActorRiskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const cap = await requireDashboardCapability("riskProfiles");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={await getLocale()} />;
  const session = await requireSession();
  const sp = await searchParams;
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };
  const rel = { justNow: t.cc.relJustNow, minAgo: t.cc.relMinAgo, today: t.cc.relToday };

  const range: RangeKey = (["today", "7d", "30d"] as const).includes(sp.range as RangeKey) ? (sp.range as RangeKey) : "7d";
  const filter: FilterKey = (FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as FilterKey) : "all";
  const days = RANGES[range];
  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(dayStart); rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));

  const [repItems, executions, openIncidents] = await withTenant(session.tenantId, (db) => Promise.all([
    db.reputationItem.findMany({
      where: { ...where, createdAt: { gte: rangeStart } },
      select: {
        id: true, riskLevel: true, riskCategories: true, sentiment: true, createdAt: true,
        contentItem: {
          select: {
            text: true, externalId: true, externalParentId: true,
            authorExternalId: true, authorDisplayName: true, platform: true,
            connectedAccount: { select: { externalName: true } },
          },
        },
      },
      take: 3000,
    }),
    db.platformActionExecution.findMany({
      where: { ...where, status: "executed", reason: { in: [...HIDE_REASONS, "comment_deleted"] }, executedAt: { gte: rangeStart } },
      select: { externalCommentId: true, reason: true },
    }),
    db.incident.findMany({ where: { ...where, status: "open" }, select: { relatedItems: { select: { reputationItemId: true } } } }),
  ]));

  // itemId → queueState (pending decisions).
  const queueMap = new Map<string, string>(
    (await withTenant(session.tenantId, (db) => db.actionQueueItem.findMany({ where: { ...where, itemId: { in: repItems.map((r) => r.id) } }, select: { itemId: true, queueState: true } }))).map((q) => [q.itemId, q.queueState]),
  );

  // State-truth sets keyed by external comment id (no raw ids rendered).
  const hiddenSet = new Set(executions.filter((e) => HIDE_REASONS.includes(e.reason ?? "") && e.externalCommentId).map((e) => e.externalCommentId as string));
  const resolvedSet = new Set(executions.filter((e) => e.reason === "comment_deleted" && e.externalCommentId).map((e) => e.externalCommentId as string));
  // V1.37.5 — read the referentially-integral join table (source of truth).
  const incidentItemIds = new Set(openIncidents.flatMap((i) => i.relatedItems.map((r) => r.reputationItemId)));

  // --- Aggregate by visible actor identity ---
  const actors = new Map<string, Actor>();
  let unknownRisky = 0;
  for (const r of repItems) {
    const ci = r.contentItem;
    const cats = r.riskCategories ?? [];
    const extId = ci.externalId;
    const hidden = extId ? hiddenSet.has(extId) : false;
    const resolved = extId ? resolvedSet.has(extId) : false;
    const pending = queueMap.get(r.id) === "approval_required";
    const bucket = sentimentBucket({ categories: cats, sentiment: r.sentiment as string, riskLevel: r.riskLevel as string });

    // Platform-scoped actor identity key: same id/username on two platforms is
    // NEVER merged. Stable author id → display-name fallback. No raw id is rendered.
    const key = actorIdentityKey(platformKeyFor(ci.platform), ci.authorExternalId, ci.authorDisplayName);
    if (!key) { if (bucket === "risky") unknownRisky++; continue; }

    let a = actors.get(key);
    if (!a) {
      a = {
        key, display: ci.authorDisplayName ?? t.actor.unknownProfile, platform: ci.platform,
        account: ci.connectedAccount?.externalName ?? "—",
        comments: [], recent: [], postIds: new Set(), categoryCounts: new Map(),
        pending: 0, hidden: 0, resolved: 0, lastActivity: r.createdAt, inIncident: false,
      };
      actors.set(key, a);
    }
    a.comments.push({ categories: cats, riskLevel: r.riskLevel as string, sentiment: r.sentiment as string, postId: ci.externalParentId ?? null, text: ci.text, hidden });
    if (ci.externalParentId) a.postIds.add(ci.externalParentId);
    if (pending) a.pending++;
    if (hidden) a.hidden++;
    if (resolved) a.resolved++;
    if (incidentItemIds.has(r.id)) a.inIncident = true;
    if (r.createdAt > a.lastActivity) a.lastActivity = r.createdAt;
    // Track top risk category (risky categories only).
    if (bucket === "risky") for (const c of cats) if (c !== "normal_criticism") a.categoryCounts.set(c, (a.categoryCounts.get(c) ?? 0) + 1);
    a.recent.push({ text: ci.text, category: cats[0] ?? null, riskLevel: r.riskLevel as string, hidden, pending, resolved, createdAt: r.createdAt });
  }

  // --- Score each actor; keep medium+ (risky) profiles ---
  const scored = [...actors.values()].map((a) => {
    const signals = buildActorSignals(a.comments, a.inIncident);
    const score = actorRiskScore(signals);
    const level = actorRiskLevel(score);
    const reasons = actorRiskReasons(signals);
    const topCat = [...a.categoryCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return { a, signals, score, level, reasons, topCat };
  }).filter((x) => x.score >= 25); // medium and above = a risk profile

  scored.sort((x, y) => y.score - x.score || y.signals.riskyComments - x.signals.riskyComments || y.a.lastActivity.getTime() - x.a.lastActivity.getTime());

  // --- Metric cards ---
  const riskyActors = scored.length;
  const highRisk = scored.filter((x) => x.level === "high" || x.level === "critical").length;
  const repeatedRisky = scored.filter((x) => x.signals.riskyComments >= 2).reduce((n, x) => n + x.signals.riskyComments, 0);
  const catTotals = new Map<string, number>();
  for (const x of scored) for (const [c, n] of x.a.categoryCounts) catTotals.set(c, (catTotals.get(c) ?? 0) + n);
  const topRiskCat = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // --- Apply filter chips ---
  const shown = scored.filter((x) => {
    switch (filter) {
      case "high": return x.level === "high" || x.level === "critical";
      case "scam": return x.signals.scamPhishing >= 1;
      case "abuse": return x.signals.profanityAttackHate >= 1;
      case "multipost": return x.signals.postsAppeared >= 2;
      default: return true;
    }
  });

  const chipHref = (f: FilterKey) => {
    const q = new URLSearchParams();
    if (range !== "7d") q.set("range", range);
    if (f !== "all") q.set("filter", f);
    const s = q.toString();
    return `/dashboard/actor-risk${s ? `?${s}` : ""}`;
  };
  const RangeTab = ({ k, label }: { k: RangeKey; label: string }) => {
    const q = new URLSearchParams();
    if (k !== "7d") q.set("range", k);
    if (filter !== "all") q.set("filter", filter);
    const s = q.toString();
    return (
      <Link href={`/dashboard/actor-risk${s ? `?${s}` : ""}`}
        className={`rounded-md border px-3 py-1.5 text-xs font-medium ${range === k ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`}>{label}</Link>
    );
  };

  return (
    <>
      <PageHeader eyebrow={t.actor.eyebrow} title={t.actor.title} description={t.actor.subtitle} />
      <p className="-mt-2 mb-4 text-xs text-[var(--color-muted)]">{t.actor.behaviorNote}</p>

      {/* Date range */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <RangeTab k="today" label={t.actor.rangeToday} />
        <RangeTab k="7d" label={t.actor.range7d} />
        <RangeTab k="30d" label={t.actor.range30d} />
      </div>

      {riskyActors === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-muted)]">{repItems.length === 0 ? t.actor.emptyNoActors : t.actor.emptyNoRisky}</Card>
      ) : (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.actor.mRiskyActors}</p><p className="mt-1 text-2xl font-bold">{riskyActors}</p><p className="text-[11px] text-[var(--color-muted)]">{t.actor.mRiskyActorsHint}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.actor.mHighRisk}</p><p className="mt-1 text-2xl font-bold">{highRisk}</p><p className="text-[11px] text-[var(--color-muted)]">{t.actor.mHighRiskHint}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.actor.mRepeatedRisky}</p><p className="mt-1 text-2xl font-bold">{repeatedRisky}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.actor.mTopRisk}</p><p className="mt-1 text-lg font-bold">{topRiskCat ? tEnum(t, "autoProtectCategory", topRiskCat) : "—"}</p></Card>
          </div>

          {/* Filter chips */}
          <div className="mt-4 mb-3 flex flex-wrap gap-1.5">
            {(["all", "high", "scam", "abuse", "multipost"] as FilterKey[]).map((f) => (
              <Link key={f} href={chipHref(f)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${filter === f ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`}>
                {f === "all" ? t.actor.filterAll : f === "high" ? t.actor.filterHigh : f === "scam" ? t.actor.filterScam : f === "abuse" ? t.actor.filterAbuse : t.actor.filterMultiPost}
              </Link>
            ))}
          </div>

          {shown.length === 0 ? (
            <Card className="p-6 text-sm text-[var(--color-muted)]">{t.actor.emptyFiltered}</Card>
          ) : (
            <div className="space-y-3">
              {shown.map(({ a, signals, score, level, reasons, topCat }) => (
                <Card key={a.key} className="p-0">
                  <details className="group">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold">{a.display}</span>
                          <Badge tone={LEVEL_TONE[level]}>{t.actor[`level_${level}` as "level_medium"]} · {score}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-muted)]">
                          {PLATFORM_META[a.platform as Platform]?.label ?? a.platform} · {a.account} · {a.comments.length} {t.actor.commentsWord} · <span className="text-[var(--color-danger)]">{signals.riskyComments} {t.actor.riskyWord}</span> · {a.hidden} {t.actor.hiddenWord} · {a.pending} {t.actor.pendingWord} · {signals.postsAppeared} {t.actor.postsWord}
                        </p>
                        <p className="mt-1 text-xs text-[var(--color-muted)]">
                          {t.actor.topRisk}: {topCat ? tEnum(t, "autoProtectCategory", topCat) : "—"} · {t.actor.lastActivity}: {relativeTime(a.lastActivity, rel, now)}
                        </p>
                        {reasons.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {reasons.slice(0, 3).map((rk) => (
                              <span key={rk} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]">{t.actor[`reason_${rk}` as "reason_repeatedRisky"]}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs font-medium text-[var(--color-brand)] group-open:hidden">{t.actor.viewComments} →</span>
                    </summary>

                    <div className="border-t border-[var(--color-border)] p-4">
                      {/* Risk overview + reasons */}
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t.actor.reasonsLabel}</h4>
                      <ul className="mb-4 space-y-1 text-sm">
                        {reasons.map((rk) => (<li key={rk} className="flex items-start gap-2"><span className="text-[var(--color-danger)]">•</span>{t.actor[`reason_${rk}` as "reason_repeatedRisky"]}</li>))}
                      </ul>

                      {/* Recent comments */}
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t.actor.detailRecentComments}</h4>
                      <ul className="space-y-2">
                        {a.recent.slice(0, 6).map((c, i) => (
                          <li key={i} className="rounded-lg border border-[var(--color-border)] p-2 text-sm">
                            <p className="line-clamp-2">“{c.text}”</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
                              {c.category ? <span>{tEnum(t, "autoProtectCategory", c.category)}</span> : null}
                              <span>· {tEnum(t, "risk", c.riskLevel)}</span>
                              {c.hidden ? <Badge tone="warn">{t.actor.hiddenWord}</Badge> : null}
                              {c.pending ? <Badge tone="neutral">{t.actor.pendingWord}</Badge> : null}
                              {c.resolved ? <Badge tone="ok">{t.actor.resolvedWord}</Badge> : null}
                              <span>· {relativeTime(c.createdAt, rel, now)}</span>
                            </div>
                          </li>
                        ))}
                      </ul>

                      <p className="mt-3 text-xs text-[var(--color-muted)]">{t.actor.detailPosts}: {signals.postsAppeared}</p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link href={`/dashboard/comments?q=${encodeURIComponent(a.display)}`} className="inline-block rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.actor.viewComments}</Link>
                        <Link href="/dashboard/action-queue" className="inline-block rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.actor.openInQueue}</Link>
                      </div>
                    </div>
                  </details>
                </Card>
              ))}
            </div>
          )}

          {/* Trust copy */}
          <p className="mt-5 text-xs text-[var(--color-muted)]">{t.actor.trustNote}</p>
        </>
      )}
    </>
  );
}
