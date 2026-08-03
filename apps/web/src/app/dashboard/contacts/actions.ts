"use server";

/**
 * BUSINESS Contacts V1 — server actions. Server-authoritative: tenant + actor come ONLY from the session
 * (requireDashboardCapability → session). Requires the Business entitlement AND the manage permission. The
 * client submits only a contactId + a bounded status/assignee value. Audit metadata is ids + enums only — never
 * PII (email/phone/name/message). Validation is manual (repo/domain are the authority); results are bounded.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, Permission, isValidContactStatus, BusinessContactStatus } from "@guardora/core";
import { setBusinessContactStatus, assignBusinessContact, addBusinessContactNote } from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { writeAudit } from "@/server/audit";
import { isSameOrigin } from "@/server/csrf";

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
