import "server-only";
import {
  readUserSession, withTenant, getTenantBilling,
  listInboxPage, inboxCounts, INBOX_PAGE_SIZE,
  setInboxRead, setInboxArchived, setInboxPriority, setInboxWorkflowStatus,
  type InboxItemRow, type InboxFilterInput,
} from "@guardora/db";
import {
  classifyWorkspaceRouting, emitOpsEvent, can, Permission,
  PLATFORM_META, type Platform,
} from "@guardora/core";
import { projectStoredClassification, sentimentBucket } from "@guardora/ai";
import { getRealModeFilter } from "@/server/data-mode";
import {
  boundedKey, isKnownAuditEvent, sinceFor,
  CLASSIFICATION_STATES, CONNECTOR_HEALTH_STATES, INBOX_PRIORITIES, INBOX_PROCESSING_STATES,
  INBOX_RISKS, INBOX_SENTIMENTS, INBOX_WORKFLOWS,
  type ClassificationState, type ConnectorHealthKey, type InboxDeps, type InboxSourceRow,
  type InboxDetailSource, type InboxActionState, type InboxPriorityKey, type InboxProcessingState,
  type InboxQuery, type InboxRiskKey, type InboxSentimentKey, type InboxWorkflowKey,
} from "./mobile-inbox";

/**
 * M4 — the ONE wiring of the mobile Inbox service to real server data.
 *
 * Every source is the SAME one the web Inbox uses: `listInboxPage` (canonical keyset
 * pagination), `inboxCounts`, the four internal mutation functions, and the
 * `projectStoredClassification` customer projection. Nothing is re-implemented, and
 * no provider API is reachable from here.
 */

/** Hide-execution reasons the web maps to a terminal public state. */
const HIDE_REASONS = ["live_hide_executed", "already_hidden"];

const sessionDeps = {
  readUserSession,
  classifyWorkspace: (kind: unknown) => classifyWorkspaceRouting(kind),
  emitOpsEvent,
};

/** Translate the validated mobile query into the canonical repo filter input. */
function toFilterInput(
  query: InboxQuery,
  userId: string,
  since: Date | undefined,
  brandWhere: InboxFilterInput["brandWhere"],
): InboxFilterInput {
  return {
    view: query.view,
    // `assigned_me` resolves from the SESSION user, never a client-supplied id.
    selfUserId: userId,
    platformIn: query.provider ? ([query.provider] as InboxFilterInput["platformIn"]) : undefined,
    type: query.type ?? undefined,
    sentiment: query.sentiment ?? undefined,
    workflowStatus: query.workflow as InboxFilterInput["workflowStatus"],
    priority: query.priority as InboxFilterInput["priority"],
    riskLevel: query.risk as InboxFilterInput["riskLevel"],
    labelId: query.label ?? undefined,
    assigneeId: query.assignee ?? undefined,
    since,
    q: query.q ?? undefined,
    brandWhere,
  };
}

/**
 * Reduce a canonical inbox row to the bounded presentation shape.
 *
 * The customer-visible risk, categories and classification state come from
 * `projectStoredClassification` — the single place that decides what a customer may
 * be told — and the sentiment bucket is computed from that PROJECTION, never from
 * the raw stored verdict. An unverified accusation therefore cannot present as
 * "risky", exactly as on web.
 *
 * The projection's admin-only `stored` block is deliberately not read here.
 */
function toSourceRow(
  row: InboxItemRow,
  ctx: { actionState: InboxActionState },
): InboxSourceRow {
  const content = row.contentItem;
  const projected = projectStoredClassification({
    riskLevel: row.riskLevel as string,
    riskCategories: row.riskCategories ?? [],
    riskConfidence: row.riskConfidence as number,
    aiDiagnostics: row.aiDiagnostics,
  } as never);

  const bucket = sentimentBucket({
    categories: projected.categories,
    sentiment: row.sentiment as string,
    riskLevel: projected.riskLevel,
  });

  const account = content.connectedAccount;
  return {
    id: row.id,
    type: content.kind === "review" ? "review" : "comment",
    text: content.text ?? null,
    author: content.authorDisplayName ?? null,
    platform: content.platform as string,
    account: account?.externalName ?? null,
    createdAt: row.createdAt,
    permalink: content.permalink ?? null,
    rating: content.rating ?? null,

    sentiment: boundedKey<InboxSentimentKey>(INBOX_SENTIMENTS, bucket, "neutral"),
    risk: boundedKey<InboxRiskKey>(INBOX_RISKS, projected.riskLevel, "none"),
    classification: boundedKey<ClassificationState>(CLASSIFICATION_STATES, projected.state, "no_issue"),
    categories: projected.categories,
    requiresReanalysis: projected.autoProtect.requiresReanalysis || row.customerRequiresReanalysis === true,

    isRead: row.isRead,
    archived: row.archivedAt !== null,
    priority: boundedKey<InboxPriorityKey>(INBOX_PRIORITIES, row.priority as string, "normal"),
    workflow: boundedKey<InboxWorkflowKey>(INBOX_WORKFLOWS, row.inboxWorkflowStatus as string, "new"),
    // Display name only — never the member's email.
    assignee: row.assignedTo ? { id: row.assignedTo.id, name: row.assignedTo.name ?? "—" } : null,
    labels: row.inboxLabels.map((l) => ({ id: l.label.id, name: l.label.name, colorKey: l.label.colorKey })),
    noteCount: row._count.inboxNotes,

    actionState: ctx.actionState,
    processing: boundedKey<InboxProcessingState>(INBOX_PROCESSING_STATES, row.processingStatus as string, "pending"),
    // Honest health: only a genuinely connected+healthy account reads as healthy.
    connectorHealth: connectorHealthFor(account),
  };
}

/** Map the connected account's stored state to a bounded health key. Never a fake green. */
function connectorHealthFor(
  account: { status: string | null; health: string | null; lastError: string | null } | null | undefined,
): ConnectorHealthKey {
  if (!account) return "api_unavailable";
  if (account.status === "needs_reconnect" || account.status === "disconnected") return "disconnected";
  if (account.status === "invalid_token" || account.status === "missing_permission") return "permission_missing";
  if (account.health === "error") return "error";
  if (account.health === "degraded") return "rate_limited";
  if (account.status === "active" && account.health === "healthy") return "healthy";
  return boundedKey<ConnectorHealthKey>(CONNECTOR_HEALTH_STATES, account.health, "api_unavailable");
}

/**
 * Page-bounded public/action state, mirroring the web cascade. Both lookups are
 * restricted to the ids on THIS page, so the cost never grows with the inbox.
 */
async function actionStatesFor(
  tenantId: string,
  rows: InboxItemRow[],
): Promise<Map<string, InboxActionState>> {
  const out = new Map<string, InboxActionState>();
  if (rows.length === 0) return out;

  const ids = rows.map((r) => r.id);
  const externalIds = rows.map((r) => r.contentItem.externalId).filter((v): v is string => !!v);

  const [executions, queued] = await withTenant(tenantId, (db) =>
    Promise.all([
      externalIds.length
        ? db.platformActionExecution.findMany({
            where: {
              tenantId, status: "executed",
              reason: { in: [...HIDE_REASONS, "comment_deleted", "facebook_can_hide_false"] },
              externalCommentId: { in: externalIds },
            },
            select: { externalCommentId: true, reason: true },
          })
        : Promise.resolve([] as { externalCommentId: string | null; reason: string | null }[]),
      db.actionQueueItem.findMany({
        where: { tenantId, itemId: { in: ids } },
        select: { itemId: true, queueState: true },
      }),
    ]),
  );

  // Terminal precedence, as on web: deleted > hidden > cannot_hide.
  const execState = new Map<string, "deleted" | "hidden" | "cannot_hide">();
  for (const e of executions) {
    if (!e.externalCommentId) continue;
    const prev = execState.get(e.externalCommentId);
    const next = e.reason === "comment_deleted" ? "deleted" : HIDE_REASONS.includes(e.reason ?? "") ? "hidden" : "cannot_hide";
    if (prev === "deleted" || (prev === "hidden" && next === "cannot_hide")) continue;
    execState.set(e.externalCommentId, next);
  }
  const queueState = new Map(queued.map((q) => [q.itemId, q.queueState as string]));

  for (const row of rows) {
    const ext = row.contentItem.externalId;
    const st = ext ? execState.get(ext) : undefined;
    const qs = queueState.get(row.id);
    const state: InboxActionState =
      st === "deleted" ? "deleted"
        : st === "hidden" ? "hidden"
          : st === "cannot_hide" ? "cannot_hide"
            : qs === "approval_required" ? "pending"
              : qs === "monitor" ? "monitored"
                : qs === "no_action" ? "no_action"
                  : (row.riskCategories ?? []).includes("normal_criticism") ? "kept"
                    : "captured";
    out.set(row.id, state);
  }
  return out;
}

export function realInboxDeps(): InboxDeps {
  return {
    ...sessionDeps,

    // The canonical permission — not a mobile RBAC copy.
    canAct: (role) => can(role as Parameters<typeof can>[0], Permission.InboxAct),

    /**
     * Authoritative write state. Restricted/suspended tenants are read-only, which
     * the server enforces here regardless of what the client believes.
     */
    hasWriteAccess: async (tenantId) => {
      const billing = await getTenantBilling(tenantId);
      const state = billing?.accessState ?? "full_access";
      return state !== "restricted" && state !== "suspended";
    },

    listInbox: async ({ tenantId, userId, query, since }) => {
      const realMode = await getRealModeFilter(tenantId);
      const filters = toFilterInput(query, userId, since, realMode.brandWhere);

      // Keyset page + server-computed counts. All filtering/search happens in
      // Postgres — nothing is filtered in JS, and there is no OFFSET.
      const [page, counts] = await Promise.all([
        listInboxPage(tenantId, filters, { cursor: query.cursor, dir: "next", pageSize: INBOX_PAGE_SIZE }),
        inboxCounts(tenantId, { brandWhere: realMode.brandWhere, since }),
      ]);

      const states = await actionStatesFor(tenantId, page.rows);
      return {
        rows: page.rows.map((r) => toSourceRow(r, { actionState: states.get(r.id) ?? "captured" })),
        nextCursor: page.hasNext ? page.nextCursor : null,
        hasMore: page.hasNext,
        counts: {
          total: counts.total, unread: counts.unread, archived: counts.archived,
          assigned: counts.assigned, unassigned: counts.unassigned,
        },
      };
    },

    /**
     * Detail, resolved INSIDE the tenant boundary. This deliberately runs through
     * `listInboxPage`'s own where-builder semantics via a tenant-scoped query rather
     * than `findUnique({ id })`, so an item belonging to another tenant returns null
     * — indistinguishable from one that does not exist.
     */
    getInboxItem: async ({ tenantId, itemId }): Promise<InboxDetailSource | null> => {
      // NOT `findUnique({ id })`. The tenant is in the predicate AND enforced by RLS
      // through `withTenant`, so an item belonging to another tenant matches nothing
      // and is indistinguishable from one that does not exist.
      const [row, notes, activity] = await withTenant(tenantId, (db) =>
        Promise.all([
          db.reputationItem.findFirst({ where: { id: itemId, tenantId }, select: INBOX_DETAIL_SELECT }),
          db.inboxNote.findMany({
            where: { reputationItemId: itemId, deletedAt: null },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
          }),
          db.auditLog.findMany({
            where: { tenantId, targetType: "reputation_item", targetId: itemId, event: { startsWith: "inbox." } },
            orderBy: { createdAt: "desc" },
            take: 20,
            // id/event/createdAt ONLY — no actor, no ip, no metadata payload.
            select: { id: true, event: true, createdAt: true },
          }),
        ]),
      );
      if (!row) return null;

      const states = await actionStatesFor(tenantId, [row as InboxItemRow]);
      return {
        ...toSourceRow(row as InboxItemRow, { actionState: states.get(itemId) ?? "captured" }),
        notes: notes.map((n) => ({
          id: n.id, body: n.body, authorName: n.author?.name ?? null, createdAt: n.createdAt,
        })),
        activity: activity
          .filter((a) => isKnownAuditEvent(a.event))
          .map((a) => ({ id: a.id, event: a.event, at: a.createdAt })),
      };
    },

    /** Delegates to the canonical repo mutations. No parallel write logic exists. */
    mutateInbox: async ({ tenantId, userId, itemId, action, priority, workflow }) => {
      switch (action) {
        case "read": return setInboxRead(tenantId, itemId, true, userId);
        case "unread": return setInboxRead(tenantId, itemId, false, userId);
        case "archive": return setInboxArchived(tenantId, itemId, true, userId);
        case "unarchive": return setInboxArchived(tenantId, itemId, false, userId);
        case "priority":
          return setInboxPriority(tenantId, itemId, priority as Parameters<typeof setInboxPriority>[2], userId);
        case "workflow":
          return setInboxWorkflowStatus(tenantId, itemId, workflow as Parameters<typeof setInboxWorkflowStatus>[2], userId);
        default:
          return { ok: false, reason: "invalid_action" };
      }
    },

    getInboxOptions: async ({ tenantId }) => {
      const [labels, members, platforms] = await withTenant(tenantId, (db) =>
        Promise.all([
          db.inboxLabel.findMany({
            where: { tenantId }, orderBy: { name: "asc" }, take: 100,
            select: { id: true, name: true, colorKey: true },
          }),
          // Display name only — no email, per the minimal-PII rule.
          db.membership.findMany({
            where: { tenantId }, take: 100,
            select: { user: { select: { id: true, name: true } } },
          }),
          db.connectedAccount.findMany({
            where: { tenantId }, distinct: ["platform"], select: { platform: true },
          }),
        ]),
      );

      return {
        platforms: platforms
          .map((p) => p.platform as string)
          .filter((p) => !!PLATFORM_META[p as Platform]),
        labels: labels.map((l) => ({ id: l.id, name: l.name, colorKey: l.colorKey })),
        members: members
          .map((m) => ({ id: m.user.id, name: m.user.name ?? "—" }))
          .filter((m) => !!m.id),
      };
    },
  };
}

/**
 * The detail select. Mirrors the canonical list select but deliberately OMITS the
 * admin-only AI diagnostics surface that the web page joins for owners
 * (UsageEvent cost/tokens/model, ProviderCall status) — mobile never serves it.
 */
const INBOX_DETAIL_SELECT = {
  id: true, riskLevel: true, riskCategories: true, sentiment: true, createdAt: true,
  customerRequiresReanalysis: true, riskConfidence: true, aiDiagnostics: true,
  isRead: true, archivedAt: true, priority: true, inboxWorkflowStatus: true,
  processingStatus: true,
  assignedTo: { select: { id: true, name: true, email: true } },
  inboxLabels: { select: { label: { select: { id: true, name: true, colorKey: true } } } },
  _count: { select: { inboxNotes: true } },
  contentItem: {
    select: {
      text: true, kind: true, rating: true, externalId: true, permalink: true,
      authorDisplayName: true, platform: true,
      connectedAccount: { select: { externalName: true, status: true, health: true, lastError: true } },
    },
  },
} as const;

export { INBOX_PAGE_SIZE, sinceFor };
