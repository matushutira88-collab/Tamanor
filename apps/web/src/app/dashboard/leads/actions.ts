"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LeadStatus, platformUpdateLead, eraseLeads } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { logPlatformSecurityEvent } from "@/server/platform-auth";

function asStatus(raw: string): LeadStatus {
  if (!(Object.values(LeadStatus) as string[]).includes(raw)) {
    throw new Error(`Unknown lead status: ${raw}`);
  }
  return raw as LeadStatus;
}

function back(id: string, notice: string): never {
  revalidatePath(`/dashboard/leads/${id}`);
  revalidatePath("/dashboard/leads");
  redirect(`/dashboard/leads/${id}?kind=ok&notice=${encodeURIComponent(notice)}`);
}

// Each mutation INDEPENDENTLY enforces the platform boundary at the service layer — `platformUpdateLead`
// resolves the platform role from the session user id and throws `platform_forbidden` unless the
// caller has `leads:write` (platform staff/admin). Tenant Owner/Admin never qualify. Fail-closed;
// no lead PII is logged (field name only, never the note body / email / status content).
export async function updateLeadStatus(id: string, status: string): Promise<void> {
  const session = await requireSession();
  const next = asStatus(status);
  await platformUpdateLead(session.userId, id, { status: next });
  logPlatformSecurityEvent("platform.lead_mutated", { actorUserId: session.userId, leadId: id, field: "status" });
  back(id, `Status set to ${next}.`);
}

export async function saveLeadNotes(id: string, formData: FormData): Promise<void> {
  const session = await requireSession();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await platformUpdateLead(session.userId, id, { notes });
  logPlatformSecurityEvent("platform.lead_mutated", { actorUserId: session.userId, leadId: id, field: "notes" });
  back(id, "Notes saved.");
}

/**
 * V1.45C3 — irreversible lead erasure. `eraseLeads` re-authorizes independently at the service layer
 * (`leads:erase`, Platform Admin ONLY — staff/tenant roles are denied there regardless of this action).
 * The lead id is the existing route resource identifier; NO lead email/PII is placed in any URL/log.
 * On success the whole Lead row (all PII/content) is hard-deleted and the user returns to the list.
 */
export async function eraseLeadAction(id: string): Promise<void> {
  const session = await requireSession();
  const res = await eraseLeads(session.userId, { mode: "lead_id", leadId: id });
  logPlatformSecurityEvent("platform.lead_erased", { actorUserId: session.userId, operationId: res.operationId, matchedCount: res.matchedCount });
  revalidatePath("/dashboard/leads");
  redirect("/dashboard/leads?erased=1");
}
