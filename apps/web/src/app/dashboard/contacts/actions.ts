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
import { setBusinessContactStatus, assignBusinessContact } from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { writeAudit } from "@/server/audit";

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
