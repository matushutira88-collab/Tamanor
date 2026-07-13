"use server";

/**
 * V1.42 — Unified Inbox server actions. Every internal mutation is tenant-scoped (repo runs
 * through `withTenantDb`/RLS), permission-gated (`InboxAct`) and audited (in the repo). Provider
 * WRITE actions are NOT handled here — they flow through the existing approval/execute path and
 * are re-verified by the engine. Bulk is internal-only and hard-capped.
 */
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth";
import { e2eMutationDelayMs } from "@/lib/e2e-seam";
import { Permission, can, isInboxBulkAllowed } from "@guardora/core";
import {
  setInboxRead, setInboxArchived, setInboxPriority, setInboxWorkflowStatus,
  assignInboxItem, createInboxLabel, renameInboxLabel, deleteInboxLabel,
  addInboxItemLabel, removeInboxItemLabel, addInboxNote, softDeleteInboxNote, bulkInboxAction,
  type InboxMutationResult,
  type Priority, type InboxWorkflowStatus,
} from "@guardora/db";

async function gate() {
  const session = await requireSession();
  if (!can(session.role, Permission.InboxAct)) throw new Error("permission_denied");
  // Fail-closed E2E-only delay so a mutation's pending/disabled state is observable in a browser
  // (double-submit proof). Inert in real production (seam off → 0ms). Changes no business result.
  const delay = e2eMutationDelayMs();
  if (delay) await new Promise((r) => setTimeout(r, delay));
  return session;
}
function done(r: InboxMutationResult): InboxMutationResult {
  revalidatePath("/dashboard/comments");
  return r;
}

export async function markReadAction(itemId: string, read: boolean) {
  const s = await gate();
  return done(await setInboxRead(s.tenantId, itemId, read, s.userId));
}
export async function toggleArchiveAction(itemId: string, archived: boolean) {
  const s = await gate();
  return done(await setInboxArchived(s.tenantId, itemId, archived, s.userId));
}
/** Form-action wrappers (return void, as a <form action> requires). */
export async function markReadFormAction(itemId: string, read: boolean): Promise<void> { await markReadAction(itemId, read); }
export async function archiveFormAction(itemId: string, archived: boolean): Promise<void> { await toggleArchiveAction(itemId, archived); }
export async function setPriorityAction(itemId: string, priority: Priority) {
  const s = await gate();
  return done(await setInboxPriority(s.tenantId, itemId, priority, s.userId));
}
export async function setWorkflowStatusAction(itemId: string, status: InboxWorkflowStatus) {
  const s = await gate();
  return done(await setInboxWorkflowStatus(s.tenantId, itemId, status, s.userId));
}
export async function assignAction(itemId: string, assigneeUserId: string | null) {
  const s = await gate();
  return done(await assignInboxItem(s.tenantId, itemId, assigneeUserId, s.userId));
}
export async function createLabelAction(name: string, colorKey?: string) {
  const s = await gate();
  return done(await createInboxLabel(s.tenantId, name, colorKey, s.userId));
}
export async function renameLabelAction(labelId: string, name: string) {
  const s = await gate();
  return done(await renameInboxLabel(s.tenantId, labelId, name, s.userId));
}
export async function deleteLabelAction(labelId: string) {
  const s = await gate();
  return done(await deleteInboxLabel(s.tenantId, labelId, s.userId));
}
export async function addLabelAction(itemId: string, labelId: string) {
  const s = await gate();
  return done(await addInboxItemLabel(s.tenantId, itemId, labelId, s.userId));
}
export async function removeLabelAction(itemId: string, labelId: string) {
  const s = await gate();
  return done(await removeInboxItemLabel(s.tenantId, itemId, labelId, s.userId));
}
export async function addNoteAction(itemId: string, body: string) {
  const s = await gate();
  return done(await addInboxNote(s.tenantId, itemId, s.userId, body));
}
export async function deleteNoteAction(noteId: string) {
  const s = await gate();
  return done(await softDeleteInboxNote(s.tenantId, noteId, s.userId));
}

/** Bulk INTERNAL actions only. The server rejects anything not on the internal bulk allowlist. */
export async function bulkAction(
  itemIds: string[],
  kind: string,
  opts: { priority?: Priority; status?: InboxWorkflowStatus; assigneeUserId?: string | null; labelId?: string } = {},
): Promise<InboxMutationResult> {
  const s = await gate();
  if (!isInboxBulkAllowed(kind)) return { ok: false, reason: "action_not_bulk_eligible" };
  return done(await bulkInboxAction(s.tenantId, itemIds, kind as Parameters<typeof bulkInboxAction>[2], s.userId, opts));
}
