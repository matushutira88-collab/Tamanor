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
import { withTenant } from "@guardora/db";
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

export default async function CommentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const session = await requireSession();
  const sp = await searchParams;
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };
  const canAct = can(session.role, Permission.InboxAct); // viewers see no mutation controls
  const rel = { justNow: t.cc.relJustNow, minAgo: t.cc.relMinAgo, today: t.cc.relToday };

  const range: RangeKey = (["today", "7d", "30d"] as const).includes(sp.range as RangeKey) ? (sp.range as RangeKey) : "7d";
  const filter: FilterKey = (FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as FilterKey) : "all";
  const provider = (sp.provider ?? "all");
  const typeFilter: "all" | "comment" | "review" = sp.type === "comment" || sp.type === "review" ? sp.type : "all";
  const q = (sp.q ?? "").trim();
  // V1.42B — persisted inbox filters (reload-safe via URL params). Default view hides archived.
  const view = (["unread", "archived", "assigned_me", "unassigned"] as const).includes(sp.view as never) ? (sp.view as string) : "default";
  const wf = (["new", "in_review", "action_required", "resolved"] as const).includes(sp.status as never) ? sp.status : undefined;
  const prio = (["low", "normal", "high", "urgent"] as const).includes(sp.priority as never) ? sp.priority : undefined;
  const labelFilter = (sp.label ?? "").trim() || undefined;
  const assigneeFilter = (sp.assignee ?? "").trim() || undefined; // explicit member filter (any member)
  const inboxWhere: Record<string, unknown> = {
    ...(view === "unread" ? { isRead: false } : {}),
    ...(view === "assigned_me" ? { assignedToUserId: session.userId } : {}),
    ...(view === "unassigned" ? { assignedToUserId: null } : {}),
    ...(view === "archived" ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...(wf ? { inboxWorkflowStatus: wf } : {}),
    ...(prio ? { priority: prio } : {}),
    ...(labelFilter ? { inboxLabels: { some: { labelId: labelFilter } } } : {}),
    ...(assigneeFilter ? { assignedToUserId: assigneeFilter } : {}),
  };
  const days = RANGES[range];
  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(dayStart); rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));

  const [repItems, executions, queueItems, accountCount, members, allLabels] = await withTenant(session.tenantId, (db) => Promise.all([
    db.reputationItem.findMany({
      where: { ...where, ...inboxWhere, createdAt: { gte: rangeStart } },
      select: {
        id: true, riskLevel: true, riskCategories: true, sentiment: true, createdAt: true,
        // V1.42B — persisted inbox workflow state rendered on the card (batched, no N+1).
        isRead: true, archivedAt: true, priority: true, inboxWorkflowStatus: true, assignedToUserId: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        inboxLabels: { select: { label: { select: { id: true, name: true, colorKey: true } } } },
        _count: { select: { inboxNotes: true } },
        contentItem: { select: { text: true, kind: true, rating: true, externalId: true, externalParentId: true, permalink: true, authorDisplayName: true, authorExternalId: true, platform: true, connectedAccount: { select: { externalName: true, status: true, health: true, lastError: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    db.platformActionExecution.findMany({ where: { ...where, status: "executed", reason: { in: [...HIDE_REASONS, "comment_deleted", "facebook_can_hide_false"] }, executedAt: { gte: rangeStart } }, select: { externalCommentId: true, reason: true } }),
    db.actionQueueItem.findMany({ where, select: { id: true, itemId: true, queueState: true } }),
    db.connectedAccount.count({ where }),
    // Active tenant members (assignee options). Membership existence = active member.
    db.membership.findMany({ where: { tenantId: session.tenantId }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.inboxLabel.findMany({ where: { tenantId: session.tenantId }, select: { id: true, name: true, colorKey: true }, orderBy: { normalizedName: "asc" } }),
  ]));

  const memberList: MemberLite[] = members.map((m) => m.user);

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
    const key = actorIdentityKey(platformKeyFor(ci.platform), ci.authorExternalId, ci.authorDisplayName);
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
    // Honest connector health (review platforms without a verified location read as verification_pending).
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
      // V1.42B — persisted inbox workflow state (rendered + mutable on the card).
      isRead: r.isRead,
      archived: r.archivedAt !== null,
      priority: r.priority as string,
      workflowStatus: r.inboxWorkflowStatus as string,
      assigneeId: r.assignedToUserId ?? null,
      assigneeName: r.assignedTo ? (r.assignedTo.name ?? r.assignedTo.email) : null,
      labels: r.inboxLabels.map((l) => l.label),
      noteCount: r._count.inboxNotes,
      connectorHealth,
    };
  });

  // Metric cards — over the full range (before filter/search).
  const mAll = rows.length;
  const mPositive = rows.filter((r) => r.bucket === "positive" || r.bucket === "neutral").length;
  const mNegative = rows.filter((r) => r.bucket === "negative").length;
  const mRiskyHidden = rows.filter((r) => r.bucket === "risky" || r.hiddenPublic).length;
  const reviewRows = rows.filter((r) => r.isReview && r.rating);
  const avgRating = reviewRows.length > 0 ? (reviewRows.reduce((s, r) => s + (r.rating ?? 0), 0) / reviewRows.length).toFixed(1) : null;
  const providersPresent = [...new Set(rows.map((r) => r.providerKey))];

  // Apply provider + type + sentiment filters + search (identical across providers).
  const ql = q.toLowerCase();
  const shown = rows.filter((r) => {
    if (provider !== "all" && r.providerKey !== provider) return false;
    if (typeFilter === "review" && !r.isReview) return false;
    if (typeFilter === "comment" && r.isReview) return false;
    const matchFilter = filter === "all" ? true
      : filter === "hidden" ? r.hiddenPublic
      : filter === "pending" ? r.pending
      : r.bucket === filter;
    if (!matchFilter) return false;
    if (!ql) return true;
    return r.text.toLowerCase().includes(ql) || r.author.toLowerCase().includes(ql) || (r.category ?? "").toLowerCase().includes(ql)
      || tEnum(t, "autoProtectCategory", r.category ?? "").toLowerCase().includes(ql)
      || r.platformLabel.toLowerCase().includes(ql) || r.account.toLowerCase().includes(ql);
  });

  // V1.42B — batch-load notes + audit for the SHOWN items only (2 bounded queries, no N+1).
  const shownIds = shown.map((r) => r.id);
  const [noteRows, auditRows] = shownIds.length ? await withTenant(session.tenantId, (db) => Promise.all([
    db.inboxNote.findMany({ where: { reputationItemId: { in: shownIds }, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, email: true } } } }),
    db.auditLog.findMany({ where: { targetType: "reputation_item", targetId: { in: shownIds }, event: { startsWith: "inbox." } }, orderBy: { createdAt: "desc" }, take: 800, include: { actor: { select: { name: true, email: true } } } }),
  ])) : [[], []];

  const notesByItem = new Map<string, NoteLite[]>();
  for (const n of noteRows) {
    const list = notesByItem.get(n.reputationItemId) ?? notesByItem.set(n.reputationItemId, []).get(n.reputationItemId)!;
    list.push({ id: n.id, body: n.body, authorName: n.author?.name ?? n.author?.email ?? "Removed member", authorId: n.authorUserId ?? null, createdAtLabel: relativeTime(n.createdAt, rel, now) });
  }
  const auditByItem = new Map<string, AuditLite[]>();
  for (const a of auditRows) {
    if (!a.targetId) continue;
    const list = auditByItem.get(a.targetId) ?? auditByItem.set(a.targetId, []).get(a.targetId)!;
    if (list.length >= 15) continue; // cap per item (already newest-first)
    list.push({ id: a.id, label: AUDIT_LABEL[a.event] ?? a.event.replace(/^inbox\./, "").replace(/_/g, " "), actor: a.actor?.name ?? a.actor?.email ?? "System", at: relativeTime(a.createdAt, rel, now) });
  }

  // Generic, reload-safe URL builder — preserves ALL active params, applies overrides ("" clears).
  const current: Record<string, string> = {};
  if (range !== "7d") current.range = range;
  if (filter !== "all") current.filter = filter;
  if (provider !== "all") current.provider = provider;
  if (typeFilter !== "all") current.type = typeFilter;
  if (q) current.q = q;
  if (view !== "default") current.view = view;
  if (wf) current.status = wf;
  if (prio) current.priority = prio;
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
      ) : mAll === 0 && view === "default" && !wf && !prio && !labelFilter && !assigneeFilter ? (
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
            {reviewRows.length > 0 ? (
              <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mReviews}</p><p className="mt-1 text-2xl font-bold">{reviewRows.length}</p><p className="text-[11px] text-[var(--color-muted)]">{t.comments.avgRating}: {avgRating} ★</p></Card>
            ) : (
              <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mRiskyHidden}</p><p className="mt-1 text-2xl font-bold">{mRiskyHidden}</p></Card>
            )}
          </div>

          {providersPresent.length > 1 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Link href={params({ provider: "all" })} className={chipCls(provider === "all")}>{t.comments.allProviders}</Link>
              {providersPresent.map((pk) => {
                const plat = ALL_PLATFORMS.find((p) => platformKeyFor(p) === pk);
                return <Link key={pk} href={params({ provider: pk })} className={chipCls(provider === pk)}>{plat ? PLATFORM_META[plat].label : pk}</Link>;
              })}
            </div>
          ) : null}

          {reviewRows.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Link href={params({ type: "all" })} className={chipCls(typeFilter === "all")}>{t.comments.typeAll}</Link>
              <Link href={params({ type: "comment" })} className={chipCls(typeFilter === "comment")}>{t.comments.typeComments}</Link>
              <Link href={params({ type: "review" })} className={chipCls(typeFilter === "review")}>{t.comments.typeReviews}</Link>
            </div>
          ) : null}

          {/* Search */}
          <form className="mt-4 flex gap-2" action="/dashboard/comments">
            {Object.entries(current).filter(([k]) => k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={q} placeholder={t.comments.searchPlaceholder} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]" />
            {q ? <Link href={params({ q: "" })} className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.searchClear}</Link> : null}
          </form>

          {/* Sentiment filter chips */}
          <div className="mt-3 mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (<Link key={f} href={params({ filter: f })} className={chipCls(filter === f)}>{FILTER_LABEL[f]}</Link>))}
          </div>

          {/* V1.42B — persisted inbox views (reload-safe via URL). Plain <a> = full navigation, so
              the URL always commits (this heavy force-dynamic page does not reliably soft-navigate
              on a searchParams-only change). */}
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="inbox-views">
            <a href={params({ view: "" })} className={chipCls(view === "default")} data-testid="view-default">Inbox</a>
            <a href={params({ view: "unread" })} className={chipCls(view === "unread")} data-testid="view-unread">Unread</a>
            <a href={params({ view: "archived" })} className={chipCls(view === "archived")} data-testid="view-archived">Archived</a>
            <a href={params({ view: "assigned_me" })} className={chipCls(view === "assigned_me")} data-testid="view-assigned">Assigned to me</a>
            <a href={params({ view: "unassigned" })} className={chipCls(view === "unassigned")} data-testid="view-unassigned">Unassigned</a>
          </div>

          {/* V1.42B — priority / workflow / label filters (reload-safe). */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="inbox-facets">
            <a href={params({ priority: "" })} className={chipCls(!prio)}>Any priority</a>
            {(["low", "normal", "high", "urgent"] as const).map((p) => <a key={p} href={params({ priority: p })} className={chipCls(prio === p)} data-testid={`prio-${p}`}>{p}</a>)}
            <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
            <a href={params({ status: "" })} className={chipCls(!wf)}>Any status</a>
            {(["new", "in_review", "action_required", "resolved"] as const).map((s) => <a key={s} href={params({ status: s })} className={chipCls(wf === s)} data-testid={`wf-${s}`}>{s.replace(/_/g, " ")}</a>)}
          </div>
          {allLabels.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="label-filter">
              <a href={params({ label: "" })} className={chipCls(!labelFilter)}>All labels</a>
              {allLabels.map((l) => <a key={l.id} href={params({ label: l.id })} className={chipCls(labelFilter === l.id)} data-testid={`label-filter-${l.id}`}><Badge tone={l.colorKey}>{l.name}</Badge></a>)}
            </div>
          ) : null}

          {/* V1.42B — tenant label management (create/rename/delete), rendered once. */}
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
                  <span className="text-xs text-[var(--color-muted)]">{shown.length} shown</span>
                </div>
              ) : null}
              <div className="space-y-3">
                {shown.map((r) => {
                  const notes = notesByItem.get(r.id) ?? [];
                  const audit = auditByItem.get(r.id) ?? [];
                  return (
                    <div key={r.id} data-inbox-item={r.id} data-read={r.isRead ? "true" : "false"} data-archived={r.archived ? "true" : "false"} data-priority={r.priority} data-status={r.workflowStatus} data-notecount={r.noteCount} data-assignee={r.assigneeId ?? ""} data-connector-health={r.connectorHealth} className="flex items-start gap-2">
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

                            {/* V1.42B — internal workflow controls. Archive is a Tamanor-side action, NOT a
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

                            {/* V1.42B — audit timeline (internal actions; body never shown). */}
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
