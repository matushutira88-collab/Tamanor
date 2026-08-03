"use server";

/**
 * BUSINESS Contacts V1 — server actions. Server-authoritative: tenant + actor come ONLY from the session
 * (requireDashboardCapability → session). Requires the Business entitlement AND the manage permission. The
 * client submits only a contactId + a bounded status/assignee value. Audit metadata is ids + enums only — never
 * PII (email/phone/name/message). Validation is manual (repo/domain are the authority); results are bounded.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  can, Permission, isValidContactStatus, BusinessContactStatus,
  normalizeBulkContactIds, summarizeBulkContacts,
} from "@guardora/core";
import {
  setBusinessContactStatus, assignBusinessContact, addBusinessContactNote,
  bulkSetBusinessContactStatus, bulkAssignBusinessContacts,
} from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { writeAudit } from "@/server/audit";
import { isSameOrigin } from "@/server/csrf";
import { businessBulkLimiter } from "@/lib/rate-limit";

const CONTACTS = "/dashboard/contacts";

async function manageGate() {
  const cap = await requireDashboardCapability("businessConnectedPlatforms");
  if (!cap.allowed) throw new Error("feature_locked");
  if (!can(cap.session.role, Permission.BusinessContactsManage)) throw new Error("permission_denied");
  return cap.session;
}

const id = (fd: FormData): string => String(fd.get("contactId") ?? "").trim();

/** Change a contact's status (bounded enum; transition validated in the repo/domain). */
export async function changeContactStatusAction(fd: FormData): Promise<void> {
  const session = await manageGate();
  const contactId = id(fd);
  const to = String(fd.get("status") ?? "");
  if (!contactId || !isValidContactStatus(to)) redirect(`${CONTACTS}?e=input`);
  const r = await setBusinessContactStatus(session.tenantId, contactId, to as BusinessContactStatus);
  if (r.ok) {
    await writeAudit({ session, event: "business_contact.status_changed", targetType: "business_contact", targetId: contactId, metadata: { to } });
  }
  revalidatePath(CONTACTS);
  redirect(`${CONTACTS}/${contactId}?${r.ok ? "saved=status" : "e=transition"}`);
}

/** Assign or unassign a contact to a tenant member (empty = unassign). */
export async function assignContactAction(fd: FormData): Promise<void> {
  const session = await manageGate();
  const contactId = id(fd);
  const raw = String(fd.get("assigneeUserId") ?? "").trim();
  const assignee = raw.length > 0 ? raw : null;
  if (!contactId) redirect(`${CONTACTS}?e=input`);
  const r = await assignBusinessContact(session.tenantId, contactId, assignee);
  if (r.ok) {
    await writeAudit({ session, event: "business_contact.assignment_changed", targetType: "business_contact", targetId: contactId, metadata: { assigned: assignee !== null } });
  }
  revalidatePath(CONTACTS);
  redirect(`${CONTACTS}/${contactId}?${r.ok ? "saved=assign" : "e=assign"}`);
}

/**
 * BUSINESS-CRM-V2 — append one internal note to a contact.
 *
 * Server-authoritative: the tenant and the AUTHOR come only from the authenticated session, and the manage
 * permission is required (a reader can view notes but never create one). The client submits exactly two
 * values: `contactId` and `body`. A contact id from another tenant fails closed in the repository (RLS) and
 * returns `not_found` before any write.
 *
 * The note text NEVER leaves the database row: it is not placed in audit metadata, ops events, the redirect
 * URL or any error query parameter. The audit entry is the bounded event `business_contact.note_added` with
 * the contact target id and no content.
 */
export async function addContactNoteAction(fd: FormData): Promise<void> {
  const session = await manageGate();
  if (!(await isSameOrigin())) redirect(`${CONTACTS}?e=csrf`);
  const contactId = id(fd);
  if (!contactId) redirect(`${CONTACTS}?e=input`);

  const r = await addBusinessContactNote(session.tenantId, contactId, session.userId, String(fd.get("body") ?? ""));
  if (r.ok) {
    // Bounded audit: contact target id only — never the note body, never an excerpt, never its length.
    await writeAudit({ session, event: "business_contact.note_added", targetType: "business_contact", targetId: contactId });
  }
  revalidatePath(`${CONTACTS}/${contactId}`);
  // Only a bounded result code reaches the URL.
  const code = r.ok ? "saved=note" : r.reason === "too_long" ? "e=note_long" : r.reason === "not_found" ? "e=not_found" : "e=note_empty";
  redirect(`${CONTACTS}/${contactId}?${code}`);
}

// ---- CRM V2 Phase B: bulk operations -----------------------------------------------------------------------
/**
 * Read the submitted selection. The browser sends ONLY contact ids (`contactIds`) plus the bounded operation
 * value — never a tenant id, actor, filter or anything else. Ids are shape-validated, de-duplicated and capped
 * in the domain layer before any database call.
 */
function readSelection(fd: FormData) {
  return normalizeBulkContactIds(fd.getAll("contactIds").map((v) => String(v)));
}

/** Bounded redirect code for a rejected selection. Never echoes an id or any submitted value. */
function selectionErrorCode(reason: "empty" | "too_many" | "invalid"): string {
  return reason === "too_many" ? "e=bulk_too_many" : reason === "invalid" ? "e=bulk_invalid" : "e=bulk_empty";
}

/**
 * Bulk status change over the explicitly selected contacts.
 *
 * Server-authoritative: tenant and actor come only from the session, and the manage permission plus the
 * Business entitlement are enforced by `manageGate()`. The repository applies the EXISTING transition rule per
 * contact under RLS, so a foreign id is simply `not_found` — indistinguishable from a deleted one, which is
 * what stops the operation confirming another tenant's contact exists.
 *
 * Only COUNTS reach the redirect and the bulk audit event; contact ids and PII never do. Each contact that
 * actually changed still receives its own `business_contact.status_changed` audit row inside the same
 * transaction, so individual timelines stay accurate.
 */
export async function bulkChangeStatusAction(fd: FormData): Promise<void> {
  const session = await manageGate();
  if (!(await isSameOrigin())) redirect(`${CONTACTS}?e=csrf`);
  if (!(await businessBulkLimiter.check(session.tenantId)).allowed) redirect(`${CONTACTS}?e=rate_limited`);

  const selection = readSelection(fd);
  if (!selection.ok) redirect(`${CONTACTS}?${selectionErrorCode(selection.reason)}`);
  const to = String(fd.get("status") ?? "");
  if (!isValidContactStatus(to)) redirect(`${CONTACTS}?e=input`);

  const outcome = await bulkSetBusinessContactStatus(session.tenantId, selection.ids, to as BusinessContactStatus, session.userId);
  const summary = summarizeBulkContacts(outcome);
  // ONE bounded bulk event: operation, target status and counts. No ids, no names, no e-mails.
  await writeAudit({
    session, event: "business_contact.bulk_status_changed", targetType: "business_contact_bulk",
    metadata: { operation: "status", to, affected: summary.affected, failed: summary.failed },
  });
  revalidatePath(CONTACTS);
  redirect(`${CONTACTS}?bulk=status&n=${summary.affected}&f=${summary.failed}`);
}

/**
 * Bulk assign / unassign over the explicitly selected contacts. An empty assignee means unassign. The assignee
 * is validated against THIS tenant's memberships before any mutation, so a foreign or unknown user id is
 * rejected rather than written. Counts only in the redirect and the bulk audit event.
 */
export async function bulkAssignAction(fd: FormData): Promise<void> {
  const session = await manageGate();
  if (!(await isSameOrigin())) redirect(`${CONTACTS}?e=csrf`);
  if (!(await businessBulkLimiter.check(session.tenantId)).allowed) redirect(`${CONTACTS}?e=rate_limited`);

  const selection = readSelection(fd);
  if (!selection.ok) redirect(`${CONTACTS}?${selectionErrorCode(selection.reason)}`);
  const raw = String(fd.get("assigneeUserId") ?? "").trim();
  const assignee = raw.length > 0 ? raw : null;

  const result = await bulkAssignBusinessContacts(session.tenantId, selection.ids, assignee, session.userId);
  if ("invalidAssignee" in result) redirect(`${CONTACTS}?e=bulk_assignee`);

  const summary = summarizeBulkContacts(result);
  await writeAudit({
    session, event: "business_contact.bulk_assigned", targetType: "business_contact_bulk",
    metadata: { operation: "assign", assigned: assignee !== null, affected: summary.affected, failed: summary.failed },
  });
  revalidatePath(CONTACTS);
  redirect(`${CONTACTS}?bulk=assign&n=${summary.affected}&f=${summary.failed}`);
}
