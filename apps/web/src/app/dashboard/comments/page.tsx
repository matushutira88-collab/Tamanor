import Link from "next/link";
import {
  buildActorSignals, actorRiskScore, actorRiskLevel, sentimentBucket,
  type ActorComment, type ActorRiskLevel, type SentimentBucket,
} from "@guardora/ai";
import { getPlatformConnector, platformKeyFor, actorIdentityKey, PLATFORM_META, ALL_PLATFORMS, can, Permission, providerCapabilities, connectorHealthStatus, type Platform, type ConnectorHealthState } from "@guardora/core";
import { InboxControls } from "./inbox-controls";
import { LabelSelector, LabelManager, type LabelLite } from "./label-editor";
import { AssigneeSelector, type MemberLite } from "./assignee-editor";
import { NotesSection, type NoteLite } from "./notes-section";
import { SelectionProvider, SelectCheckbox, SelectAllCheckbox, BulkActionBar } from "./inbox-selection";
import { PageHeader, Card, Badge, StatusDot } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import {
  withTenant, listInboxPage, inboxCounts, INBOX_PAGE_SIZE,
  type InboxItemRow, type InboxFilterInput, type InboxView,
} from "@guardora/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// V1.43 — date range is now an OPTIONAL narrowing filter over a fully paginated inbox (default:
// all-time). Pagination — not a fetch cap — bounds what the browser loads.
const RANGES = { all: null, today: 1, "7d": 7, "30d": 30 } as const;
type RangeKey = keyof typeof RANGES;
// V1.43 — the sentiment filter is a real server-side bucket predicate (positive/neutral/negative/
// risky). The old cross-table "hidden"/"pending" chips are gone: they are derived from other tables
// and cannot be keyset-paginated on reputation_items (see the release notes). Per-item hidden/pending
// state is still shown as a badge on each card.
const SENT_FILTERS = ["all", "positive", "neutral", "negative", "risky"] as const;
type FilterKey = (typeof SENT_FILTERS)[number];

const HIDE_REASONS = ["live_hide_executed", "already_hidden"];
const BUCKET_TONE: Record<SentimentBucket, "ok" | "neutral" | "warn" | "danger"> = { positive: "ok", neutral: "neutral", negative: "warn", risky: "danger" };

// V1.42B — human labels for the item audit timeline (internal, never provider moderation).
const AUDIT_LABEL: Record<string, string> = {
  "inbox.mark_read": "Marked read", "inbox.mark_unread": "Marked unread",
  "inbox.archive": "Archived in Tamanor", "inbox.unarchive": "Unarchived",
  "inbox.set_priority": "Priority changed", "inbox.set_workflow_status": "Status changed",
  "inbox.assign": "Assigned", "inbox.unassign": "Unassigned",
  "inbox.label_assign": "Label added", "inbox.label_remove": "Label removed",
  "inbox.note_add": "Note added",
};

interface AuditLite { id: string; label: string; actor: string; at: string }

interface Row {
  id: string; text: string; author: string; authorKey: string | null; platformLabel: string; account: string;
  permalink: string | null; createdAt: Date; bucket: SentimentBucket; riskLevel: string; category: string | null;
  statusKey: string; hiddenPublic: boolean; pending: boolean; resolved: boolean; queueItemId: string | null;
  actorLevel: ActorRiskLevel | null; cantHide: boolean; isReview: boolean; rating: number | null; providerKey: string;
  isRead: boolean; archived: boolean; priority: string; workflowStatus: string; assigneeId: string | null; assigneeName: string | null;
  labels: LabelLite[]; noteCount: number; connectorHealth: ConnectorHealthState;
  processingStatus: string; processingTier: string | null; processingReason: string | null; lastProcessedAt: Date | null; classifierVersion: string | null;
}

// Honest connector-health tone (never a fake green). Only a truly healthy connector is "ok".
const HEALTH_TONE: Record<ConnectorHealthState, "ok" | "warn" | "danger" | "neutral"> = {
  healthy: "ok", verification_pending: "warn", rate_limited: "warn",
  permission_missing: "danger", disconnected: "danger", api_unavailable: "neutral", error: "danger",
};
const HEALTH_LABEL: Record<ConnectorHealthState, string> = {
  healthy: "Connector healthy", verification_pending: "Verification pending", rate_limited: "Rate limited",
  permission_missing: "Permission missing", disconnected: "Disconnected", api_unavailable: "Not available", error: "Connector error",
};

// V1.44B — truthful per-item processing state. A limit/disabled/failed status NEVER implies
// fabricated analysis — it means the advanced tier did not run.
const PROCESSING_COPY: Record<string, string> = {
  pending: "Awaiting analysis",
  processed_rules: "Checked with basic protection",
  processed_local: "Checked with local AI",
  processed_paid: "Checked with advanced AI",
  cached: "Reused previous analysis",
  basic_limit_reached: "Monthly basic AI limit reached",
  premium_limit_reached: "Advanced AI limit reached",
  paid_ai_disabled: "Advanced AI is currently disabled",
  failed: "Analysis could not be completed",
};
const PROCESSING_TONE: Record<string, "ok" | "neutral" | "warn" | "danger"> = {
  pending: "neutral", processed_rules: "neutral", processed_local: "neutral", processed_paid: "ok", cached: "neutral",
  basic_limit_reached: "warn", premium_limit_reached: "warn", paid_ai_disabled: "neutral", failed: "danger",
};
const PROCESSING_LIMIT_STATES = new Set(["basic_limit_reached", "premium_limit_reached", "paid_ai_disabled"]);
const processingCopy = (s: string) => PROCESSING_COPY[s] ?? "Awaiting analysis";

export default async function CommentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const session = await requireSession();
  const sp = await searchParams;
  const realMode = await getRealModeFilter(session.tenantId);
  const canAct = can(session.role, Permission.InboxAct); // viewers see no mutation controls
  const rel = { justNow: t.cc.relJustNow, minAgo: t.cc.relMinAgo, today: t.cc.relToday };

  // ---- Parse + validate every filter from the URL (all applied server-side) ----
  const range: RangeKey = (["all", "today", "7d", "30d"] as const).includes(sp.range as never) ? (sp.range as RangeKey) : "all";
  const filter: FilterKey = (SENT_FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as FilterKey) : "all";
  const providerKey = sp.provider ?? "all";
  const typeFilter: "all" | "comment" | "review" = sp.type === "comment" || sp.type === "review" ? sp.type : "all";
  const q = (sp.q ?? "").trim();
  const view: InboxView = (["unread", "archived", "assigned_me", "unassigned"] as const).includes(sp.view as never) ? (sp.view as InboxView) : "default";
  const wf = (["new", "in_review", "action_required", "resolved"] as const).includes(sp.status as never) ? (sp.status as InboxFilterInput["workflowStatus"]) : undefined;
  const prio = (["low", "normal", "high", "urgent"] as const).includes(sp.priority as never) ? (sp.priority as InboxFilterInput["priority"]) : undefined;
  const riskLevel = (["none", "low", "medium", "high", "critical"] as const).includes(sp.risk as never) ? (sp.risk as InboxFilterInput["riskLevel"]) : undefined;
  const labelFilter = (sp.label ?? "").trim() || undefined;
  const assigneeFilter = (sp.assignee ?? "").trim() || undefined;
  const cursor = sp.cursor || null;
  const dir: "next" | "prev" = sp.dir === "prev" ? "prev" : "next";

  const now = new Date();
  let since: Date | undefined;
  if (range !== "all") {
    const days = RANGES[range] as number;
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const rangeStart = new Date(dayStart); rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));
    since = rangeStart;
  }
  const platformIn = providerKey !== "all"
    ? (ALL_PLATFORMS.filter((p) => platformKeyFor(p) === providerKey) as InboxFilterInput["platformIn"])
    : undefined;

  const filters: InboxFilterInput = {
    view, selfUserId: session.userId, platformIn,
    type: typeFilter === "all" ? undefined : typeFilter,
    sentiment: filter === "all" ? undefined : (filter as SentimentBucket),
    workflowStatus: wf, priority: prio, riskLevel, labelId: labelFilter, assigneeId: assigneeFilter,
    since, q, brandWhere: realMode.brandWhere,
  };

  // ---- One keyset page + server counts (both fully in SQL). No fetch cap; no in-memory filtering. ----
  const [page, counts] = await Promise.all([
    listInboxPage(session.tenantId, filters, { cursor, dir, pageSize: INBOX_PAGE_SIZE }),
    inboxCounts(session.tenantId, { brandWhere: realMode.brandWhere, since }),
  ]);
  const pageRows: InboxItemRow[] = page.rows;
  const pageIds = pageRows.map((r) => r.id);
  const pageExternalIds = pageRows.map((r) => r.contentItem.externalId).filter(Boolean) as string[];

  const baseWhere = { tenantId: session.tenantId, ...realMode.brandWhere };
  // ---- Per-PAGE enrichment only (bounded by the current page's ids — never the whole dataset) ----
  const [executions, queueItems, accountCount, members, allLabels, noteRows, auditRows] = await withTenant(session.tenantId, (db) => Promise.all([
    pageExternalIds.length
      ? db.platformActionExecution.findMany({ where: { ...baseWhere, status: "executed", reason: { in: [...HIDE_REASONS, "comment_deleted", "facebook_can_hide_false"] }, externalCommentId: { in: pageExternalIds } }, select: { externalCommentId: true, reason: true } })
      : Promise.resolve([] as { externalCommentId: string | null; reason: string | null }[]),
    pageIds.length ? db.actionQueueItem.findMany({ where: { ...baseWhere, itemId: { in: pageIds } }, select: { id: true, itemId: true, queueState: true } }) : Promise.resolve([] as { id: string; itemId: string; queueState: string }[]),
    db.connectedAccount.count({ where: baseWhere }),
    db.membership.findMany({ where: { tenantId: session.tenantId }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.inboxLabel.findMany({ where: { tenantId: session.tenantId }, select: { id: true, name: true, colorKey: true }, orderBy: { normalizedName: "asc" } }),
    pageIds.length ? db.inboxNote.findMany({ where: { reputationItemId: { in: pageIds }, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, email: true } } } }) : Promise.resolve([] as never[]),
    pageIds.length ? db.auditLog.findMany({ where: { targetType: "reputation_item", targetId: { in: pageIds }, event: { startsWith: "inbox." } }, orderBy: { createdAt: "desc" }, take: 400, include: { actor: { select: { name: true, email: true } } } }) : Promise.resolve([] as never[]),
  ]));

  const memberList: MemberLite[] = members.map((m) => m.user);

  // External-comment-id → terminal state (deleted > hidden > can_hide_false). Page-bounded.
  const execState = new Map<string, "deleted" | "hidden" | "cannot_hide">();
  for (const e of executions) {
    if (!e.externalCommentId) continue;
    const prev = execState.get(e.externalCommentId);
    const next = e.reason === "comment_deleted" ? "deleted" : HIDE_REASONS.includes(e.reason ?? "") ? "hidden" : "cannot_hide";
    if (prev === "deleted" || (prev === "hidden" && next === "cannot_hide")) continue;
    execState.set(e.externalCommentId, next);
  }
  const queueByItem = new Map(queueItems.map((qi) => [qi.itemId, qi]));

  // Per-author risk (medium+), computed over THIS PAGE's rows only (bounded; the full cross-item
  // actor picture lives on /dashboard/actor-risk).
  const authorComments = new Map<string, ActorComment[]>();
  for (const r of pageRows) {
    const ci = r.contentItem;
    const key = actorIdentityKey(platformKeyFor(ci.platform), ci.authorExternalId, ci.authorDisplayName);
    if (!key) continue;
    (authorComments.get(key) ?? authorComments.set(key, []).get(key)!).push({ categories: r.riskCategories ?? [], riskLevel: r.riskLevel as string, sentiment: r.sentiment as string, postId: ci.externalParentId ?? null, text: ci.text, hidden: ci.externalId ? execState.get(ci.externalId) === "hidden" : false });
  }
  const authorLevel = new Map<string, ActorRiskLevel>();
  for (const [key, comments] of authorComments) {
    const level = actorRiskLevel(actorRiskScore(buildActorSignals(comments)));
    if (level !== "low") authorLevel.set(key, level);
  }

  // Build display rows from the current page (presentation transform only — no filtering here).
  const rows: Row[] = pageRows.map((r) => {
    const ci = r.contentItem;
    const cats = r.riskCategories ?? [];
    const bucket = sentimentBucket({ categories: cats, sentiment: r.sentiment as string, riskLevel: r.riskLevel as string });
    const st = ci.externalId ? execState.get(ci.externalId) : undefined;
    const qi = queueByItem.get(r.id);
    const hiddenPublic = st === "hidden";
    const resolved = st === "deleted";
    const pending = qi?.queueState === "approval_required";
    const hiddenKey = ({ hiddenFromPublic: "st_hidden", flagged: "st_flagged", manualReview: "st_manualReview" } as const)[getPlatformConnector(platformKeyFor(ci.platform)).hiddenStateKey()];
    const statusKey = resolved ? "st_deleted"
      : hiddenPublic ? hiddenKey
      : st === "cannot_hide" ? "st_canHideFalse"
      : pending ? "st_pending"
      : qi?.queueState === "monitor" ? "st_monitored"
      : qi?.queueState === "no_action" ? "st_noAction"
      : cats.includes("normal_criticism") ? "st_kept"
      : "st_captured";
    const key = actorIdentityKey(platformKeyFor(ci.platform), ci.authorExternalId, ci.authorDisplayName);
    const pk = platformKeyFor(ci.platform);
    const caps = getPlatformConnector(platformKeyFor(ci.platform)).capabilities;
    const acc = ci.connectedAccount;
    const connectorHealth = connectorHealthStatus({
      platform: pk, supported: providerCapabilities(pk).canReadContent,
      status: acc?.status, health: acc?.health, lastError: acc?.lastError,
      reviewPlatform: ci.kind === "review", verifiedLocationCount: 0,
    });
    return {
      id: r.id, text: ci.text, author: ci.authorDisplayName ?? t.comments.unknownAuthor, authorKey: key,
      platformLabel: PLATFORM_META[ci.platform as Platform]?.label ?? ci.platform, account: ci.connectedAccount?.externalName ?? "—", permalink: ci.permalink,
      createdAt: r.createdAt, bucket, riskLevel: r.riskLevel as string, category: cats[0] ?? null,
      statusKey, hiddenPublic, pending, resolved, queueItemId: qi?.id ?? null, actorLevel: key ? authorLevel.get(key) ?? null : null,
      cantHide: bucket === "risky" && !caps.canHideComment && !hiddenPublic && !resolved,
      isReview: ci.kind === "review",
      rating: ci.rating ?? null,
      providerKey: platformKeyFor(ci.platform),
      isRead: r.isRead,
      archived: r.archivedAt !== null,
      priority: r.priority as string,
      workflowStatus: r.inboxWorkflowStatus as string,
      assigneeId: r.assignedToUserId ?? null,
      assigneeName: r.assignedTo ? (r.assignedTo.name ?? r.assignedTo.email) : null,
      labels: r.inboxLabels.map((l) => l.label),
      noteCount: r._count.inboxNotes,
      connectorHealth,
      processingStatus: (r.processingStatus as string) ?? "pending",
      processingTier: (r.processingTier as string | null) ?? null,
      processingReason: r.processingReason ?? null,
      lastProcessedAt: r.lastProcessedAt ?? null,
      classifierVersion: r.classifierVersion ?? null,
    };
  });

  // Everything that filtered in memory before is now in SQL — the page IS the shown set.
  const shown = rows;
  const shownIds = shown.map((r) => r.id);

  // Metric cards from SERVER counts (correct regardless of pagination).
  const mAll = counts.total;
  const mPositive = counts.sentiment.positive + counts.sentiment.neutral;
  const mNegative = counts.sentiment.negative;
  const mRisky = counts.sentiment.risky;
  const avgRating = counts.avgRating !== null ? counts.avgRating.toFixed(1) : null;
  const hasReviews = counts.reviews > 0;
  // Providers actually present (from server counts, not the current page).
  const providersPresent = [...new Set(Object.keys(counts.byPlatform).map((pl) => platformKeyFor(pl as Platform)))];

  // Batch notes + audit for the SHOWN page items (already page-bounded above).
  const notesByItem = new Map<string, NoteLite[]>();
  for (const n of noteRows as Array<{ id: string; body: string; reputationItemId: string; authorUserId: string | null; createdAt: Date; author: { name: string | null; email: string } | null }>) {
    const list = notesByItem.get(n.reputationItemId) ?? notesByItem.set(n.reputationItemId, []).get(n.reputationItemId)!;
    list.push({ id: n.id, body: n.body, authorName: n.author?.name ?? n.author?.email ?? "Removed member", authorId: n.authorUserId ?? null, createdAtLabel: relativeTime(n.createdAt, rel, now) });
  }
  const auditByItem = new Map<string, AuditLite[]>();
  for (const a of auditRows as Array<{ id: string; targetId: string | null; event: string; createdAt: Date; actor: { name: string | null; email: string } | null }>) {
    if (!a.targetId) continue;
    const list = auditByItem.get(a.targetId) ?? auditByItem.set(a.targetId, []).get(a.targetId)!;
    if (list.length >= 15) continue;
    list.push({ id: a.id, label: AUDIT_LABEL[a.event] ?? a.event.replace(/^inbox\./, "").replace(/_/g, " "), actor: a.actor?.name ?? a.actor?.email ?? "System", at: relativeTime(a.createdAt, rel, now) });
  }

  // Generic, reload-safe URL builder. `current` DELIBERATELY excludes cursor/dir, so changing any
  // filter resets pagination to page 1; prev/next set cursor/dir explicitly.
  const current: Record<string, string> = {};
  if (range !== "all") current.range = range;
  if (filter !== "all") current.filter = filter;
  if (providerKey !== "all") current.provider = providerKey;
  if (typeFilter !== "all") current.type = typeFilter;
  if (q) current.q = q;
  if (view !== "default") current.view = view;
  if (wf) current.status = wf;
  if (prio) current.priority = prio;
  if (riskLevel) current.risk = riskLevel;
  if (labelFilter) current.label = labelFilter;
  if (assigneeFilter) current.assignee = assigneeFilter;
  const params = (over: Record<string, string | undefined>) => {
    const merged = { ...current };
    for (const [k, v] of Object.entries(over)) { if (v === undefined || v === "") delete merged[k]; else merged[k] = v; }
    const p = new URLSearchParams(merged);
    const s = p.toString();
    return `/dashboard/comments${s ? `?${s}` : ""}`;
  };
  const chipCls = (active: boolean) => `rounded-md border px-3 py-1.5 text-xs font-medium ${active ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`;
  const cnt = (n: number | undefined) => (n ? ` (${n})` : "");
  const FILTER_LABEL: Record<FilterKey, string> = { all: t.comments.fAll, positive: t.comments.fPositive, neutral: t.comments.fNeutral, negative: t.comments.fNegative, risky: t.comments.fRisky };
  const onFirstPage = !cursor;

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
      ) : counts.total === 0 && counts.archived === 0 && view === "default" && !wf && !prio && !riskLevel && !labelFilter && !assigneeFilter && !q && providerKey === "all" && filter === "all" ? (
        <Card className="p-6">
          <p className="text-sm font-medium">{t.comments.emptyNoComments}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.comments.emptyNoCommentsBody}</p>
        </Card>
      ) : (
        <>
          {/* Date range */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            <a href={params({ range: "" })} className={chipCls(range === "all")} data-testid="range-all">All time</a>
            <a href={params({ range: "today" })} className={chipCls(range === "today")}>{t.comments.rangeToday}</a>
            <a href={params({ range: "7d" })} className={chipCls(range === "7d")}>{t.comments.range7d}</a>
            <a href={params({ range: "30d" })} className={chipCls(range === "30d")}>{t.comments.range30d}</a>
          </div>

          {/* Metric cards (server counts) */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mAll}</p><p className="mt-1 text-2xl font-bold" data-testid="metric-total">{mAll}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mPositive}</p><p className="mt-1 text-2xl font-bold">{mPositive}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mNegative}</p><p className="mt-1 text-2xl font-bold">{mNegative}</p></Card>
            {hasReviews ? (
              <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mReviews}</p><p className="mt-1 text-2xl font-bold">{counts.reviews}</p><p className="text-[11px] text-[var(--color-muted)]">{t.comments.avgRating}: {avgRating} ★</p></Card>
            ) : (
              <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mRiskyHidden}</p><p className="mt-1 text-2xl font-bold">{mRisky}</p></Card>
            )}
          </div>

          {providersPresent.length > 1 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              <a href={params({ provider: "" })} className={chipCls(providerKey === "all")}>{t.comments.allProviders}</a>
              {providersPresent.map((pk) => {
                const plat = ALL_PLATFORMS.find((p) => platformKeyFor(p) === pk);
                const n = Object.entries(counts.byPlatform).filter(([pl]) => platformKeyFor(pl as Platform) === pk).reduce((s, [, v]) => s + v, 0);
                return <a key={pk} href={params({ provider: pk })} className={chipCls(providerKey === pk)}>{(plat ? PLATFORM_META[plat].label : pk) + cnt(n)}</a>;
              })}
            </div>
          ) : null}

          {hasReviews ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <a href={params({ type: "" })} className={chipCls(typeFilter === "all")}>{t.comments.typeAll}</a>
              <a href={params({ type: "comment" })} className={chipCls(typeFilter === "comment")}>{t.comments.typeComments}</a>
              <a href={params({ type: "review" })} className={chipCls(typeFilter === "review")}>{t.comments.typeReviews}</a>
            </div>
          ) : null}

          {/* Search (server-side) */}
          <form className="mt-4 flex gap-2" action="/dashboard/comments">
            {Object.entries(current).filter(([k]) => k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={q} placeholder={t.comments.searchPlaceholder} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]" data-testid="inbox-search" />
            {q ? <Link href={params({ q: "" })} className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.searchClear}</Link> : null}
          </form>

          {/* Sentiment filter chips (server-side bucket predicate) */}
          <div className="mt-3 mb-3 flex flex-wrap gap-1.5">
            {SENT_FILTERS.map((f) => (<a key={f} href={params({ filter: f })} className={chipCls(filter === f)}>{FILTER_LABEL[f]}</a>))}
          </div>

          {/* Persisted inbox views (reload-safe; full navigation) with server counts. */}
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="inbox-views">
            <a href={params({ view: "" })} className={chipCls(view === "default")} data-testid="view-default">Inbox{cnt(counts.total)}</a>
            <a href={params({ view: "unread" })} className={chipCls(view === "unread")} data-testid="view-unread">Unread{cnt(counts.unread)}</a>
            <a href={params({ view: "archived" })} className={chipCls(view === "archived")} data-testid="view-archived">Archived{cnt(counts.archived)}</a>
            <a href={params({ view: "assigned_me" })} className={chipCls(view === "assigned_me")} data-testid="view-assigned">Assigned to me</a>
            <a href={params({ view: "unassigned" })} className={chipCls(view === "unassigned")} data-testid="view-unassigned">Unassigned{cnt(counts.unassigned)}</a>
          </div>

          {/* Priority / workflow / risk filters (reload-safe) with server counts. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="inbox-facets">
            <a href={params({ priority: "" })} className={chipCls(!prio)}>Any priority</a>
            {(["low", "normal", "high", "urgent"] as const).map((p) => <a key={p} href={params({ priority: p })} className={chipCls(prio === p)} data-testid={`prio-${p}`}>{p + cnt(counts.byPriority[p])}</a>)}
            <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
            <a href={params({ status: "" })} className={chipCls(!wf)}>Any status</a>
            {(["new", "in_review", "action_required", "resolved"] as const).map((s) => <a key={s} href={params({ status: s })} className={chipCls(wf === s)} data-testid={`wf-${s}`}>{s.replace(/_/g, " ") + cnt(counts.byWorkflow[s])}</a>)}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="risk-filter">
            <a href={params({ risk: "" })} className={chipCls(!riskLevel)}>Any risk</a>
            {(["low", "medium", "high", "critical"] as const).map((rk) => <a key={rk} href={params({ risk: rk })} className={chipCls(riskLevel === rk)} data-testid={`risk-${rk}`}>{tEnum(t, "risk", rk)}</a>)}
          </div>
          {allLabels.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="label-filter">
              <a href={params({ label: "" })} className={chipCls(!labelFilter)}>All labels</a>
              {allLabels.map((l) => <a key={l.id} href={params({ label: l.id })} className={chipCls(labelFilter === l.id)} data-testid={`label-filter-${l.id}`}><Badge tone={l.colorKey}>{l.name}{cnt(counts.byLabel[l.id])}</Badge></a>)}
            </div>
          ) : null}

          {/* Tenant label management (create/rename/delete), rendered once. */}
          <LabelManager allLabels={allLabels} canAct={canAct} />

          {shown.length === 0 ? (
            <Card className="p-6 text-sm text-[var(--color-muted)]" data-testid="inbox-empty">{
              q ? t.comments.emptySearch
              : view === "unread" ? "No unread items."
              : view === "archived" ? "Nothing archived."
              : view === "assigned_me" ? "Nothing assigned to you."
              : view === "unassigned" ? "No unassigned items."
              : t.comments.emptyFilter
            }</Card>
          ) : (
            <SelectionProvider>
              {canAct ? (
                <div className="mb-2 flex items-center gap-2">
                  <SelectAllCheckbox ids={shownIds} />
                  <span className="text-xs text-[var(--color-muted)]">{shown.length} on this page · {counts.total} total</span>
                </div>
              ) : null}
              <div className="space-y-3">
                {shown.map((r) => {
                  const notes = notesByItem.get(r.id) ?? [];
                  const audit = auditByItem.get(r.id) ?? [];
                  return (
                    <div key={r.id} data-inbox-item={r.id} data-read={r.isRead ? "true" : "false"} data-archived={r.archived ? "true" : "false"} data-priority={r.priority} data-status={r.workflowStatus} data-notecount={r.noteCount} data-assignee={r.assigneeId ?? ""} data-connector-health={r.connectorHealth} data-processing={r.processingStatus} className="flex items-start gap-2">
                      {/* Bulk checkbox lives OUTSIDE the <summary> (an interactive control nested in a
                          summary is an a11y anti-pattern and would toggle the disclosure). */}
                      {canAct ? <div className="pt-4"><SelectCheckbox id={r.id} /></div> : null}
                      <Card className="p-0 flex-1 min-w-0">
                        <details className="group">
                          <summary className="flex cursor-pointer flex-col gap-2 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              {!r.isRead ? <span data-testid="unread-dot" className="inline-block h-2 w-2 rounded-full bg-[var(--color-brand)]" title="Unread" /> : null}
                              {r.isReview ? <Badge tone="brand">{t.gbp.reviewType}</Badge> : null}
                              {r.isReview && r.rating ? <span className="text-xs font-semibold text-[var(--color-warn)]">{"★".repeat(Math.max(0, Math.min(5, r.rating)))}{"☆".repeat(Math.max(0, 5 - r.rating))}</span> : null}
                              <Badge tone={BUCKET_TONE[r.bucket]}>{t.rep[`bucket_${r.bucket}` as "bucket_positive"]}</Badge>
                              {r.priority !== "normal" ? <Badge tone={r.priority === "urgent" ? "danger" : r.priority === "high" ? "warn" : "neutral"}>{r.priority}</Badge> : null}
                              <Badge tone="neutral">{r.workflowStatus.replace(/_/g, " ")}</Badge>
                              <span data-testid="processing-badge" data-status={r.processingStatus}><Badge tone={PROCESSING_TONE[r.processingStatus] ?? "neutral"}>{processingCopy(r.processingStatus)}</Badge></span>
                              {r.archived ? <Badge tone="neutral">Archived</Badge> : null}
                              {r.assigneeName ? <Badge tone="neutral">@{r.assigneeName}</Badge> : null}
                              {r.labels.map((l) => <Badge key={l.id} tone={l.colorKey}>{l.name}</Badge>)}
                              {r.noteCount > 0 ? <Badge tone="neutral">{r.noteCount} note{r.noteCount === 1 ? "" : "s"}</Badge> : null}
                              {r.category ? <Badge tone="neutral">{tEnum(t, "autoProtectCategory", r.category)}</Badge> : null}
                              {r.hiddenPublic ? <Badge tone="warn">{t.comments.hiddenPublic}</Badge> : null}
                              {r.pending ? <Badge tone="neutral">{t.comments.pendingDecision}</Badge> : null}
                              {r.actorLevel ? <Link href="/dashboard/actor-risk"><Badge tone={r.actorLevel === "medium" ? "warn" : "danger"}>{t.actor.badgePrefix}: {t.actor[`level_${r.actorLevel}` as "level_medium"]}</Badge></Link> : null}
                            </div>
                            {/* Rating-only reviews carry no text — never fabricate one. */}
                            {r.text ? <p className="text-sm">{r.text}</p> : r.isReview ? <p className="text-sm italic text-[var(--color-muted)]" data-testid="rating-only">Rating only — no written review.</p> : null}
                            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--color-muted)]">
                              <span>{r.author} · {r.platformLabel} · {r.account} · {relativeTime(r.createdAt, rel, now)} · {t.comments[r.statusKey as "st_captured"]}</span>
                              <span data-testid="connector-health" data-health={r.connectorHealth}><StatusDot tone={HEALTH_TONE[r.connectorHealth]}>{HEALTH_LABEL[r.connectorHealth]}</StatusDot></span>
                            </p>
                          </summary>

                          <div className="border-t border-[var(--color-border)] p-4 text-sm">
                            {r.text ? <p className="mb-3 whitespace-pre-wrap">{r.text}</p> : null}
                            <dl className="space-y-1.5 text-xs">
                              <Row2 label={t.comments.author}>{r.author}</Row2>
                              <Row2 label={t.comments.platform}>{r.platformLabel}</Row2>
                              <Row2 label={t.comments.account}>{r.account}</Row2>
                              <Row2 label={t.comments.sentiment}>{t.rep[`bucket_${r.bucket}` as "bucket_positive"]}</Row2>
                              <Row2 label={t.comments.risk}>{tEnum(t, "risk", r.riskLevel)}{r.category ? ` · ${tEnum(t, "autoProtectCategory", r.category)}` : ""}</Row2>
                              <Row2 label={t.comments.status}>{t.comments[r.statusKey as "st_captured"]}</Row2>
                              {r.permalink ? <Row2 label={t.comments.post}><a href={r.permalink} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand)] hover:underline">{t.comments.post} →</a></Row2> : null}
                            </dl>
                            {r.hiddenPublic ? <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs text-[var(--color-muted)]">{t.common.hiddenFromPublicHelp}</p> : null}
                            {r.cantHide ? <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs text-[var(--color-muted)]">{t.comments.cantHideNote}</p> : null}

                            {/* V1.44B — truthful processing state. Limit/disabled states link to usage; never a fake error. */}
                            <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs" data-testid="processing-detail" data-status={r.processingStatus}>
                              <span className="font-medium">{processingCopy(r.processingStatus)}</span>
                              {r.processingTier ? <span className="text-[var(--color-muted)]"> · {r.processingTier} tier</span> : null}
                              {r.lastProcessedAt ? <span className="text-[var(--color-muted)]"> · checked {relativeTime(r.lastProcessedAt, rel, now)}</span> : null}
                              {r.classifierVersion ? <span className="text-[var(--color-muted)]"> · {r.classifierVersion}</span> : null}
                              {PROCESSING_LIMIT_STATES.has(r.processingStatus) ? (
                                <div className="mt-1"><Link href="/dashboard/usage" className="text-[var(--color-brand)] hover:underline" data-testid="processing-usage-link">View usage &amp; limits →</Link></div>
                              ) : null}
                            </div>

                            {/* Internal workflow controls. Archive is a Tamanor-side action, NOT a
                                provider hide; "resolved" never implies provider moderation. */}
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                              <section>
                                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Workflow</h4>
                                <InboxControls id={r.id} isRead={r.isRead} archived={r.archived} priority={r.priority} workflowStatus={r.workflowStatus} canAct={canAct} />
                                <div className="mt-2"><AssigneeSelector itemId={r.id} assigneeId={r.assigneeId} members={memberList} selfId={session.userId} canAct={canAct} /></div>
                              </section>
                              <section>
                                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Labels</h4>
                                <LabelSelector itemId={r.id} labels={r.labels} allLabels={allLabels} canAct={canAct} />
                              </section>
                            </div>

                            <section className="mt-4">
                              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Notes <span className="font-normal normal-case text-[var(--color-muted)]">· internal, never sent to the platform</span></h4>
                              <NotesSection itemId={r.id} notes={notes} selfId={session.userId} canAct={canAct} />
                            </section>

                            {/* Audit timeline (internal actions; body never shown). */}
                            <section className="mt-4">
                              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Activity</h4>
                              <ul className="flex flex-col gap-1 text-xs" data-testid="audit-timeline">
                                {audit.length ? audit.map((a) => (
                                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-[var(--color-muted)]">
                                    <span className="font-medium text-[var(--color-fg)]">{a.label}</span>
                                    <span>· {a.actor} · {a.at}</span>
                                  </li>
                                )) : <li className="text-[var(--color-muted)]">No activity yet.</li>}
                              </ul>
                            </section>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {r.queueItemId ? <Link href={`/dashboard/action-queue/${r.queueItemId}`} className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openInQueue}</Link> : null}
                              {r.actorLevel ? <Link href="/dashboard/actor-risk" className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openActor}</Link> : null}
                              <Link href="/dashboard/reputation" className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openReputation}</Link>
                            </div>
                          </div>
                        </details>
                      </Card>
                    </div>
                  );
                })}
              </div>
              {canAct ? <BulkActionBar members={memberList} allLabels={allLabels} /> : null}
            </SelectionProvider>
          )}

          {/* V1.43 — keyset pager. Plain <a> (full navigation); cursor + dir live in the URL, so a
              refresh reloads the SAME page. Changing any filter above drops cursor → back to page 1. */}
          <nav className="mt-4 flex items-center justify-between gap-2" data-testid="inbox-pager">
            <div className="flex gap-1.5">
              {!onFirstPage ? <a href={params({ cursor: "", dir: "" })} className={chipCls(false)} data-testid="page-newest">⇤ Newest</a> : null}
              {page.hasPrev ? <a href={params({ cursor: page.prevCursor ?? undefined, dir: "prev" })} className={chipCls(false)} data-testid="page-prev">← Previous</a> : <span className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium opacity-40">← Previous</span>}
            </div>
            <span className="text-xs text-[var(--color-muted)]" data-testid="page-info">{shown.length ? `Showing ${shown.length} of ${counts.total}` : `0 of ${counts.total}`}</span>
            <div>
              {page.hasNext ? <a href={params({ cursor: page.nextCursor ?? undefined, dir: "next" })} className={chipCls(false)} data-testid="page-next">Next →</a> : <span className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium opacity-40">Next →</span>}
            </div>
          </nav>

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
