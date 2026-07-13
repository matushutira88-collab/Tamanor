/**
 * V1.42 — Unified Inbox persistence repository. Every function runs through `withTenantDb`
 * (RLS runtime), so isolation is DB-enforced even if a filter is forgotten. Cross-tenant
 * label/note links are DB-impossible (composite (childId, tenantId) FKs); a foreign assignee
 * is rejected by an active-membership check. Every mutation writes a tenant-scoped audit entry
 * that NEVER contains a note body, token or raw provider content.
 */
import { ActorKind, Prisma, type Priority, type InboxWorkflowStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
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
export function listInboxItemsWithState(tenantId: string, where: Prisma.ReputationItemWhereInput = {}, take = 500) {
  return withTenantDb(tenantId, (db) => db.reputationItem.findMany({
    where, take, orderBy: { createdAt: "desc" },
    include: {
      contentItem: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      inboxLabels: { include: { label: { select: { id: true, name: true, colorKey: true } } } },
      _count: { select: { inboxNotes: true } },
    },
  }));
}
