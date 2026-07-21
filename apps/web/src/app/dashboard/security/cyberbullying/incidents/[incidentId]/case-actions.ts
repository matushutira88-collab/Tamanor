"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateProtectionPlan, updateFollowUp, setCaseMilestone, createCaseTask, updateCaseTask } from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";

/**
 * C9 — Server Actions for case management. Each re-checks the session and delegates
 * to the fail-closed @guardora/db service (permission + incident scope + validation
 * + transactional audit/timeline). Everything is a human decision. Errors redirect
 * back with a short, non-revealing CODE (never a raw message / note content).
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const path = (id: string) => `/dashboard/security/cyberbullying/incidents/${id}`;

function classify(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  return code === "forbidden" || code === "not_found" || code === "invalid_transition" || code === "validation" ? code : "error";
}

async function finish(incidentId: string, run: () => Promise<void>): Promise<never> {
  let err: string | null = null;
  try { await run(); } catch (e) { err = classify(e); }
  revalidatePath(path(incidentId));
  redirect(err ? `${path(incidentId)}?cerr=${err}#case` : `${path(incidentId)}?cok=1#case`);
}

export async function updateProtectionPlanAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  if (!incidentId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await finish(incidentId, () => updateProtectionPlan(actor, incidentId, {
    riskLevel: str(formData, "riskLevel"), protectionStatus: str(formData, "protectionStatus"),
    objective: str(formData, "objective"), notes: str(formData, "notes"),
  }));
}

export async function updateFollowUpAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  if (!incidentId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await finish(incidentId, () => updateFollowUp(actor, incidentId, {
    nextReviewAt: str(formData, "nextReviewAt"), lastReviewAt: str(formData, "lastReviewAt"), followUpNotes: str(formData, "followUpNotes"),
  }));
}

export async function setMilestoneAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  if (!incidentId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  const key = str(formData, "milestone");
  const achieved = str(formData, "achieved") === "1";
  await finish(incidentId, () => setCaseMilestone(actor, incidentId, key, achieved));
}

export async function createCaseTaskAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  if (!incidentId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await finish(incidentId, async () => { await createCaseTask(actor, incidentId, {
    title: str(formData, "title"), description: str(formData, "description") || null,
    assigneeUserId: str(formData, "assigneeUserId") || null, dueDate: str(formData, "dueDate") || null,
  }); });
}

export async function updateCaseTaskAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  const taskId = str(formData, "taskId");
  if (!incidentId || !taskId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  // Only fields present in the form are sent; a status-only quick action just sets status.
  const patch: { title?: string; description?: string | null; status?: string; assigneeUserId?: string | null; dueDate?: string | null } = {};
  if (formData.has("status")) patch.status = str(formData, "status");
  if (formData.has("title")) patch.title = str(formData, "title");
  if (formData.has("description")) patch.description = str(formData, "description") || null;
  if (formData.has("assigneeUserId")) patch.assigneeUserId = str(formData, "assigneeUserId") || null;
  if (formData.has("dueDate")) patch.dueDate = str(formData, "dueDate") || null;
  await finish(incidentId, () => updateCaseTask(actor, incidentId, taskId, patch));
}
