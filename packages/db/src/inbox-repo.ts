/**
 * V1.42 — Unified Inbox persistence repository. Every function runs through `withTenantDb`
 * (RLS runtime), so isolation is DB-enforced even if a filter is forgotten. Cross-tenant
 * label/note links are DB-impossible (composite (childId, tenantId) FKs); a foreign assignee
 * is rejected by an active-membership check. Every mutation writes a tenant-scoped audit entry
 * that NEVER contains a note body, token or raw provider content.
 */
import { ActorKind, Prisma, type Priority, type InboxWorkflowStatus, type Platform, type RiskLevel } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { sentimentBucketWhere, type SentimentBucket } from "@guardora/ai";
import { withTenantDb, type TenantTx } from "./tenant-db";

export type InboxMutationResult =
  | { ok: true; id?: string; affected?: number }
  | { ok: false; reason: string };

const NOTE_MAX = 5000;
const BULK_MAX = 200;
const COLOR_KEYS = new Set(["neutral", "brand", "ok", "warn", "danger", "info"]);
const safeColor = (c?: string) => (c && COLOR_KEYS.has(c) ? c : "neutral");
const normalizeLabel = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const cid = () => `inb_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

function isUnique(e: unknown) { return (e as { code?: string })?.code === "P2002"; }
function isFk(e: unknown) { return (e as { code?: string })?.code === "P2003"; }

async function audit(
  db: TenantTx, tenantId: string, actorUserId: string | null,
  event: string, targetType: string | null, targetId: string | null, metadata: Record<string, unknown>,
): Promise<void> {
  await db.auditLog.create({
    data: { tenantId, event, actorKind: ActorKind.human, actorUserId: actorUserId ?? undefined, targetType: targetType ?? undefined, targetId: targetId ?? undefined, metadata: metadata as Prisma.InputJsonValue },
  });
}

// --------------------------- read / unread ---------------------------
export function setInboxRead(tenantId: string, itemId: string, isRead: boolean, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const r = await db.reputationItem.updateMany({ where: { id: itemId }, data: { isRead } });
    if (r.count === 0) return { ok: false, reason: "not_found" };
    await audit(db, tenantId, actorUserId, isRead ? "inbox.mark_read" : "inbox.mark_unread", "reputation_item", itemId, { correlationId: cid() });
    return { ok: true };
  });
}

// --------------------------- archive ---------------------------
export function setInboxArchived(tenantId: string, itemId: string, archived: boolean, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const r = await db.reputationItem.updateMany({ where: { id: itemId }, data: { archivedAt: archived ? new Date() : null } });
    if (r.count === 0) return { ok: false, reason: "not_found" };
    // Internal archive is NOT provider moderation — the audit event says so explicitly.
    await audit(db, tenantId, actorUserId, archived ? "inbox.archive" : "inbox.unarchive", "reputation_item", itemId, { correlationId: cid(), internal: true });
    return { ok: true };
  });
}

// --------------------------- priority / workflow status ---------------------------
export function setInboxPriority(tenantId: string, itemId: string, priority: Priority, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const r = await db.reputationItem.updateMany({ where: { id: itemId }, data: { priority } });
    if (r.count === 0) return { ok: false, reason: "not_found" };
    await audit(db, tenantId, actorUserId, "inbox.set_priority", "reputation_item", itemId, { correlationId: cid(), priority });
    return { ok: true };
  });
}

export function setInboxWorkflowStatus(tenantId: string, itemId: string, status: InboxWorkflowStatus, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const r = await db.reputationItem.updateMany({ where: { id: itemId }, data: { inboxWorkflowStatus: status } });
    if (r.count === 0) return { ok: false, reason: "not_found" };
    // `resolved` here is internal triage — it does NOT imply any provider comment was moderated.
    await audit(db, tenantId, actorUserId, "inbox.set_workflow_status", "reputation_item", itemId, { correlationId: cid(), status });
    return { ok: true };
  });
}

// --------------------------- assignment ---------------------------
export function assignInboxItem(tenantId: string, itemId: string, assigneeUserId: string | null, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    if (assigneeUserId) {
      // Assignee must be an ACTIVE member of THIS tenant (memberships are RLS-scoped).
      const member = await db.membership.findFirst({ where: { userId: assigneeUserId, tenantId } });
      if (!member) return { ok: false, reason: "assignee_not_member" };
    }
    const r = await db.reputationItem.updateMany({ where: { id: itemId }, data: { assignedToUserId: assigneeUserId } });
    if (r.count === 0) return { ok: false, reason: "not_found" };
    await audit(db, tenantId, actorUserId, assigneeUserId ? "inbox.assign" : "inbox.unassign", "reputation_item", itemId, { correlationId: cid(), assigneeUserId: assigneeUserId ?? null });
    return { ok: true };
  });
}

// --------------------------- labels ---------------------------
export function createInboxLabel(tenantId: string, name: string, colorKey: string | undefined, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const normalizedName = normalizeLabel(name);
    if (!normalizedName) return { ok: false, reason: "invalid_name" };
    try {
      const label = await db.inboxLabel.create({ data: { tenantId, name: name.trim(), normalizedName, colorKey: safeColor(colorKey), createdByUserId: actorUserId } });
      await audit(db, tenantId, actorUserId, "inbox.label_create", "inbox_label", label.id, { correlationId: cid() });
      return { ok: true, id: label.id };
    } catch (e) { if (isUnique(e)) return { ok: false, reason: "duplicate_label" }; throw e; }
  });
}

export function renameInboxLabel(tenantId: string, labelId: string, name: string, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const normalizedName = normalizeLabel(name);
    if (!normalizedName) return { ok: false, reason: "invalid_name" };
    try {
      const r = await db.inboxLabel.updateMany({ where: { id: labelId }, data: { name: name.trim(), normalizedName } });
      if (r.count === 0) return { ok: false, reason: "not_found" };
      await audit(db, tenantId, actorUserId, "inbox.label_rename", "inbox_label", labelId, { correlationId: cid() });
      return { ok: true };
    } catch (e) { if (isUnique(e)) return { ok: false, reason: "duplicate_label" }; throw e; }
  });
}

export function deleteInboxLabel(tenantId: string, labelId: string, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const r = await db.inboxLabel.deleteMany({ where: { id: labelId } }); // join rows Cascade; items stay
    if (r.count === 0) return { ok: false, reason: "not_found" };
    await audit(db, tenantId, actorUserId, "inbox.label_delete", "inbox_label", labelId, { correlationId: cid() });
    return { ok: true };
  });
}

export function addInboxItemLabel(tenantId: string, itemId: string, labelId: string, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    try {
      // Composite (id, tenantId) FKs make a cross-tenant item/label impossible at the DB level.
      await db.inboxItemLabel.create({ data: { tenantId, reputationItemId: itemId, labelId, createdByUserId: actorUserId } });
    } catch (e) {
      if (isUnique(e)) return { ok: true }; // already labelled — idempotent
      if (isFk(e)) return { ok: false, reason: "item_or_label_missing" };
      throw e;
    }
    await audit(db, tenantId, actorUserId, "inbox.label_assign", "reputation_item", itemId, { correlationId: cid(), labelId });
    return { ok: true };
  });
}

export function removeInboxItemLabel(tenantId: string, itemId: string, labelId: string, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const r = await db.inboxItemLabel.deleteMany({ where: { reputationItemId: itemId, labelId } });
    if (r.count === 0) return { ok: false, reason: "not_found" };
    await audit(db, tenantId, actorUserId, "inbox.label_remove", "reputation_item", itemId, { correlationId: cid(), labelId });
    return { ok: true };
  });
}

// --------------------------- notes (plain text; body NEVER audited/logged) ---------------------------
export function addInboxNote(tenantId: string, itemId: string, authorUserId: string, body: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const clean = body.trim();
    if (!clean) return { ok: false, reason: "empty_note" };
    if (clean.length > NOTE_MAX) return { ok: false, reason: "note_too_long" };
    try {
      const note = await db.inboxNote.create({ data: { tenantId, reputationItemId: itemId, authorUserId, body: clean } });
      await audit(db, tenantId, authorUserId, "inbox.note_add", "reputation_item", itemId, { correlationId: cid(), noteId: note.id }); // no body
      return { ok: true, id: note.id };
    } catch (e) { if (isFk(e)) return { ok: false, reason: "item_missing" }; throw e; }
  });
}

export function listInboxNotes(tenantId: string, itemId: string) {
  return withTenantDb(tenantId, (db) => db.inboxNote.findMany({ where: { reputationItemId: itemId, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, email: true } } } }));
}

export function softDeleteInboxNote(tenantId: string, noteId: string, actorUserId: string): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    // Author-scoped: only the note's author may delete their own note.
    const r = await db.inboxNote.updateMany({ where: { id: noteId, authorUserId: actorUserId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (r.count === 0) return { ok: false, reason: "not_found_or_not_author" };
    await audit(db, tenantId, actorUserId, "inbox.note_delete", "inbox_note", noteId, { correlationId: cid() });
    return { ok: true };
  });
}

// --------------------------- bulk (INTERNAL actions only) ---------------------------
type BulkKind =
  | "mark_read" | "mark_unread" | "archive" | "unarchive"
  | "set_priority" | "set_workflow_status" | "assign" | "unassign"
  | "add_label" | "remove_label";

export function bulkInboxAction(
  tenantId: string, itemIds: string[], kind: BulkKind, actorUserId: string,
  opts: { priority?: Priority; status?: InboxWorkflowStatus; assigneeUserId?: string | null; labelId?: string } = {},
): Promise<InboxMutationResult> {
  return withTenantDb(tenantId, async (db) => {
    const ids = [...new Set(itemIds)].slice(0, BULK_MAX);
    if (ids.length === 0) return { ok: false, reason: "empty_selection" };

    // Label kinds operate on the join table (composite (id, tenantId) FKs keep them tenant-safe).
    if (kind === "add_label" || kind === "remove_label") {
      if (!opts.labelId) return { ok: false, reason: "label_required" };
      if (!(await db.inboxLabel.findFirst({ where: { id: opts.labelId } }))) return { ok: false, reason: "item_or_label_missing" };
      let affected = 0;
      if (kind === "add_label") {
        // Only link items that actually exist in THIS tenant (RLS-scoped findMany).
        const items = await db.reputationItem.findMany({ where: { id: { in: ids } }, select: { id: true } });
        const res = await db.inboxItemLabel.createMany({
          data: items.map((it) => ({ tenantId, reputationItemId: it.id, labelId: opts.labelId!, createdByUserId: actorUserId })),
          skipDuplicates: true,
        });
        affected = res.count;
      } else {
        const res = await db.inboxItemLabel.deleteMany({ where: { reputationItemId: { in: ids }, labelId: opts.labelId } });
        affected = res.count;
      }
      await audit(db, tenantId, actorUserId, `inbox.bulk_${kind}`, null, null, { correlationId: cid(), requested: ids.length, affected, labelId: opts.labelId });
      return { ok: true, affected };
    }

    let data: Record<string, unknown>;
    switch (kind) {
      case "mark_read": data = { isRead: true }; break;
      case "mark_unread": data = { isRead: false }; break;
      case "archive": data = { archivedAt: new Date() }; break;
      case "unarchive": data = { archivedAt: null }; break;
      case "set_priority": if (!opts.priority) return { ok: false, reason: "priority_required" }; data = { priority: opts.priority }; break;
      case "set_workflow_status": if (!opts.status) return { ok: false, reason: "status_required" }; data = { inboxWorkflowStatus: opts.status }; break;
      case "assign":
        if (!opts.assigneeUserId) return { ok: false, reason: "assignee_required" };
        if (!(await db.membership.findFirst({ where: { userId: opts.assigneeUserId, tenantId } }))) return { ok: false, reason: "assignee_not_member" };
        data = { assignedToUserId: opts.assigneeUserId }; break;
      case "unassign": data = { assignedToUserId: null }; break;
    }
    // RLS scopes the update to this tenant; foreign ids simply don't match.
    const r = await db.reputationItem.updateMany({ where: { id: { in: ids } }, data });
    await audit(db, tenantId, actorUserId, `inbox.bulk_${kind}`, null, null, { correlationId: cid(), requested: ids.length, affected: r.count });
    return { ok: true, affected: r.count };
  });
}

// --------------------------- read with joined state (no N+1) ---------------------------
// NOTE: `take` is OPTIONAL and unbounded by default (V1.43 removed the fixed 500 cap). The inbox
// RUNTIME never calls this — it uses the keyset-paginated `listInboxPage` below. This helper is
// retained for small, id/predicate-scoped reads in tests only.
export function listInboxItemsWithState(tenantId: string, where: Prisma.ReputationItemWhereInput = {}, take?: number) {
  return withTenantDb(tenantId, (db) => db.reputationItem.findMany({
    where, ...(take ? { take } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      contentItem: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      inboxLabels: { include: { label: { select: { id: true, name: true, colorKey: true } } } },
      _count: { select: { inboxNotes: true } },
    },
  }));
}

// ===========================================================================================
// V1.43 — CANONICAL inbox query layer. ONE where-builder, ONE keyset paginator, ONE counts
// function — the single source of truth for the inbox runtime. All filtering + search + sorting
// runs in Postgres (RLS-scoped via withTenantDb); nothing is filtered or searched in memory.
// ===========================================================================================

export type InboxView = "default" | "unread" | "archived" | "assigned_me" | "unassigned";

/** All inbox filters. Every field maps to a Prisma predicate — NONE is applied in JS. */
export interface InboxFilterInput {
  view?: InboxView;
  selfUserId?: string;                 // resolves `assigned_me`
  platformIn?: Platform[];             // provider filter (caller maps provider-key → platforms)
  type?: "comment" | "review";         // content type (relation filter)
  sentiment?: SentimentBucket;         // pushed down via sentimentBucketWhere (canonical)
  workflowStatus?: InboxWorkflowStatus;
  priority?: Priority;
  riskLevel?: RiskLevel;
  labelId?: string;
  assigneeId?: string;                 // explicit member filter (any member)
  since?: Date;                        // date-range lower bound on createdAt
  q?: string;                          // server-side search (author/text/connector/label)
  brandWhere?: Prisma.ReputationItemWhereInput; // real-mode brand scoping from the caller
}

/**
 * Build the FULL Prisma `where` for the inbox. `tenantId` is included explicitly (in addition to
 * RLS) so the planner can use the tenant-prefixed keyset index. Search uses parameterized
 * `contains` (ILIKE) — Prisma binds the value, so there is no SQL-injection surface.
 */
export function buildInboxWhere(tenantId: string, f: InboxFilterInput): Prisma.ReputationItemWhereInput {
  const and: Prisma.ReputationItemWhereInput[] = [{ tenantId }];
  if (f.brandWhere) and.push(f.brandWhere);

  switch (f.view) {
    case "unread": and.push({ isRead: false, archivedAt: null }); break;
    case "archived": and.push({ archivedAt: { not: null } }); break;
    case "assigned_me": and.push({ assignedToUserId: f.selfUserId ?? "__no_user__", archivedAt: null }); break;
    case "unassigned": and.push({ assignedToUserId: null, archivedAt: null }); break;
    default: and.push({ archivedAt: null }); // default inbox hides archived
  }

  if (f.platformIn?.length) and.push({ platform: { in: f.platformIn } });
  if (f.type) and.push({ contentItem: { is: { kind: f.type } } });
  if (f.workflowStatus) and.push({ inboxWorkflowStatus: f.workflowStatus });
  if (f.priority) and.push({ priority: f.priority });
  if (f.riskLevel) and.push({ riskLevel: f.riskLevel });
  if (f.labelId) and.push({ inboxLabels: { some: { labelId: f.labelId } } });
  if (f.assigneeId) and.push({ assignedToUserId: f.assigneeId });
  if (f.since) and.push({ createdAt: { gte: f.since } });
  if (f.sentiment) and.push(sentimentBucketWhere(f.sentiment) as Prisma.ReputationItemWhereInput);

  const q = (f.q ?? "").trim();
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    and.push({ OR: [
      { contentItem: { is: { text: contains } } },
      { contentItem: { is: { authorDisplayName: contains } } },
      { contentItem: { is: { connectedAccount: { is: { externalName: contains } } } } },
      { inboxLabels: { some: { label: { is: { name: contains } } } } },
    ] });
  }
  return { AND: and };
}

/** Canonical select for an inbox list row (drives both the list and its typed Row). No N+1. */
export const inboxItemSelect = {
  id: true, riskLevel: true, riskCategories: true, sentiment: true, createdAt: true,
  isRead: true, archivedAt: true, priority: true, inboxWorkflowStatus: true, assignedToUserId: true,
  // V1.44B — truthful processing state for the inbox card/detail.
  processingTier: true, processingStatus: true, processingReason: true, lastProcessedAt: true, classifierVersion: true,
  assignedTo: { select: { id: true, name: true, email: true } },
  inboxLabels: { select: { label: { select: { id: true, name: true, colorKey: true } } } },
  _count: { select: { inboxNotes: true } },
  contentItem: { select: {
    text: true, kind: true, rating: true, externalId: true, externalParentId: true, permalink: true,
    authorDisplayName: true, authorExternalId: true, platform: true,
    connectedAccount: { select: { externalName: true, status: true, health: true, lastError: true } },
  } },
} satisfies Prisma.ReputationItemSelect;

export type InboxItemRow = Prisma.ReputationItemGetPayload<{ select: typeof inboxItemSelect }>;

// --------------------------- keyset pagination (deterministic, OFFSET-free) ---------------------------
export const INBOX_PAGE_SIZE = 25;
const INBOX_PAGE_MAX = 100;
export type InboxDir = "next" | "prev";
export interface InboxCursor { c: number; i: string } // createdAt epoch ms, id (tiebreak)

export interface InboxPageResult {
  rows: InboxItemRow[];
  hasNext: boolean;
  hasPrev: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
}

function encodeCursor(cur: InboxCursor): string {
  return Buffer.from(`${cur.c}.${cur.i}`, "utf8").toString("base64url");
}
export function decodeCursor(s: string | null | undefined): InboxCursor | null {
  if (!s) return null;
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const dot = raw.indexOf(".");
    if (dot <= 0) return null;
    const c = Number(raw.slice(0, dot));
    const i = raw.slice(dot + 1);
    return Number.isFinite(c) && i ? { c, i } : null; // malformed cursor → treated as no cursor (fail-safe)
  } catch { return null; }
}

/**
 * One page of the inbox via deterministic keyset pagination on (createdAt, id). No OFFSET, so cost
 * is independent of page depth and it is stable under concurrent inserts (a strict row-value
 * comparison can never skip or duplicate an already-seen row). Fetches pageSize+1 to detect a
 * further page. `dir: "prev"` walks backwards (ascending) and reverses, giving true prev/next.
 */
export function listInboxPage(
  tenantId: string, filters: InboxFilterInput,
  opts: { cursor?: string | null; dir?: InboxDir; pageSize?: number } = {},
): Promise<InboxPageResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? INBOX_PAGE_SIZE, 1), INBOX_PAGE_MAX);
  const dir: InboxDir = opts.dir === "prev" ? "prev" : "next";
  const cur = decodeCursor(opts.cursor);
  const base = buildInboxWhere(tenantId, filters);

  return withTenantDb(tenantId, async (db) => {
    const at = cur ? new Date(cur.c) : null;
    // Row-value keyset, written so the leading `createdAt` bound is an INDEX RANGE bound (not a
    // post-filter): `createdAt <op>= X AND (createdAt <op> X OR id <op> Y)`. This is logically
    // identical to the tuple comparison (createdAt, id) </> (X, Y) but lets the planner seek to the
    // cursor in the (tenantId, createdAt, id) index, so deep pages stay O(log n) — no OFFSET.
    const keyset: Prisma.ReputationItemWhereInput | null = cur
      ? (dir === "next"
        ? { AND: [{ createdAt: { lte: at! } }, { OR: [{ createdAt: { lt: at! } }, { id: { lt: cur.i } }] }] }
        : { AND: [{ createdAt: { gte: at! } }, { OR: [{ createdAt: { gt: at! } }, { id: { gt: cur.i } }] }] })
      : null;
    const where: Prisma.ReputationItemWhereInput = keyset ? { AND: [base, keyset] } : base;
    const orderBy: Prisma.ReputationItemOrderByWithRelationInput[] =
      dir === "next" ? [{ createdAt: "desc" }, { id: "desc" }] : [{ createdAt: "asc" }, { id: "asc" }];

    const fetched = await db.reputationItem.findMany({ where, orderBy, take: pageSize + 1, select: inboxItemSelect });
    const hasMore = fetched.length > pageSize;
    let rows = hasMore ? fetched.slice(0, pageSize) : fetched;
    if (dir === "prev") rows = rows.reverse();

    const hasNext = dir === "next" ? hasMore : cur != null;
    const hasPrev = dir === "prev" ? hasMore : cur != null;
    const first = rows[0], last = rows[rows.length - 1];
    return {
      rows,
      hasNext, hasPrev,
      nextCursor: last ? encodeCursor({ c: last.createdAt.getTime(), i: last.id }) : null,
      prevCursor: first ? encodeCursor({ c: first.createdAt.getTime(), i: first.id }) : null,
    };
  });
}

// --------------------------- server-calculated counts (pagination-independent) ---------------------------
export interface InboxCounts {
  total: number; unread: number; archived: number; assigned: number; unassigned: number;
  byWorkflow: Record<string, number>;
  byPriority: Record<string, number>;
  byPlatform: Record<string, number>;
  byLabel: Record<string, number>;
  sentiment: Record<SentimentBucket, number>;
  reviews: number; avgRating: number | null;
}

/**
 * All navigation counts, computed in Postgres over the ACTIVE (non-archived) universe scoped by
 * tenant + brand + date range — so they are correct regardless of which page is shown. `archived`
 * is the one facet counted over archived rows. groupBy collapses the multi-value facets.
 */
export function inboxCounts(
  tenantId: string, base: { brandWhere?: Prisma.ReputationItemWhereInput; since?: Date },
): Promise<InboxCounts> {
  const active = buildInboxWhere(tenantId, { view: "default", brandWhere: base.brandWhere, since: base.since });
  const archived = buildInboxWhere(tenantId, { view: "archived", brandWhere: base.brandWhere, since: base.since });
  const withActive = (extra: Prisma.ReputationItemWhereInput): Prisma.ReputationItemWhereInput => ({ AND: [active, extra] });

  return withTenantDb(tenantId, async (db) => {
    const [
      total, unread, assigned, unassigned, archivedN,
      wfGroups, prioGroups, platGroups, labelGroups,
      sPos, sNeu, sNeg, sRisky, reviews, ratingAgg,
    ] = await Promise.all([
      db.reputationItem.count({ where: active }),
      db.reputationItem.count({ where: withActive({ isRead: false }) }),
      db.reputationItem.count({ where: withActive({ assignedToUserId: { not: null } }) }),
      db.reputationItem.count({ where: withActive({ assignedToUserId: null }) }),
      db.reputationItem.count({ where: archived }),
      db.reputationItem.groupBy({ by: ["inboxWorkflowStatus"], where: active, _count: { _all: true } }),
      db.reputationItem.groupBy({ by: ["priority"], where: active, _count: { _all: true } }),
      db.reputationItem.groupBy({ by: ["platform"], where: active, _count: { _all: true } }),
      db.inboxItemLabel.groupBy({ by: ["labelId"], where: { reputationItem: { is: active } }, _count: { _all: true } }),
      db.reputationItem.count({ where: withActive(sentimentBucketWhere("positive") as Prisma.ReputationItemWhereInput) }),
      db.reputationItem.count({ where: withActive(sentimentBucketWhere("neutral") as Prisma.ReputationItemWhereInput) }),
      db.reputationItem.count({ where: withActive(sentimentBucketWhere("negative") as Prisma.ReputationItemWhereInput) }),
      db.reputationItem.count({ where: withActive(sentimentBucketWhere("risky") as Prisma.ReputationItemWhereInput) }),
      db.reputationItem.count({ where: withActive({ contentItem: { is: { kind: "review" } } }) }),
      db.contentItem.aggregate({ _avg: { rating: true }, where: { kind: "review", rating: { not: null }, reputationItem: { is: active } } }),
    ]);

    const toRec = <K extends string>(g: Array<Record<string, unknown> & { _count: { _all: number } }>, key: K): Record<string, number> =>
      Object.fromEntries(g.map((row) => [String(row[key]), row._count._all]));

    return {
      total, unread, assigned, unassigned, archived: archivedN,
      byWorkflow: toRec(wfGroups as never, "inboxWorkflowStatus"),
      byPriority: toRec(prioGroups as never, "priority"),
      byPlatform: toRec(platGroups as never, "platform"),
      byLabel: toRec(labelGroups as never, "labelId"),
      sentiment: { positive: sPos, neutral: sNeu, negative: sNeg, risky: sRisky },
      reviews,
      avgRating: ratingAgg._avg.rating ?? null,
    };
  });
}
