"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import { LeadStatus, updateLead } from "@guardora/db";
import { requireSession } from "@/server/auth";

function asStatus(raw: string): LeadStatus {
  if (!(Object.values(LeadStatus) as string[]).includes(raw)) {
    throw new Error(`Unknown lead status: ${raw}`);
  }
  return raw as LeadStatus;
}

/** Leads are internal — only members-management roles may act on them. */
async function requireLeadAccess() {
  const session = await requireSession();
  assertCan(session.role, Permission.MemberManage);
  return session;
}

function back(id: string, notice: string): never {
  revalidatePath(`/dashboard/leads/${id}`);
  revalidatePath("/dashboard/leads");
  redirect(`/dashboard/leads/${id}?kind=ok&notice=${encodeURIComponent(notice)}`);
}

export async function updateLeadStatus(id: string, status: string): Promise<void> {
  await requireLeadAccess();
  const next = asStatus(status);
  await updateLead(id, { status: next });
  back(id, `Status set to ${next}.`);
}

export async function saveLeadNotes(id: string, formData: FormData): Promise<void> {
  await requireLeadAccess();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await updateLead(id, { notes });
  back(id, "Notes saved.");
}
