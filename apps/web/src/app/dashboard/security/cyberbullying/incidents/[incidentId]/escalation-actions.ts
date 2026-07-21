"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createManualEscalation, resolveEscalation, cancelEscalation } from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";

/**
 * C10 — manual escalation actions. Each delegates to the fail-closed @guardora/db
 * service (permission + incident scope + recipient validation + transactional
 * audit/timeline/notification). The confidential note never leaves the server in an
 * error. Redirects back to the incident's SLA section with a safe code.
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const path = (id: string) => `/dashboard/security/cyberbullying/incidents/${id}`;

function classify(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  return ["forbidden", "not_found", "invalid_transition", "invalid_recipient", "invalid_reason", "missing_note", "duplicate"].includes(code ?? "") ? code! : "error";
}

async function finish(incidentId: string, run: () => Promise<void>): Promise<never> {
  let err: string | null = null;
  try { await run(); } catch (e) { err = classify(e); }
  revalidatePath(path(incidentId));
  redirect(err ? `${path(incidentId)}?eerr=${err}#sla` : `${path(incidentId)}?eok=1#sla`);
}

export async function createEscalationAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  if (!incidentId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await finish(incidentId, async () => { await createManualEscalation(actor, incidentId, {
    severity: str(formData, "severity"), reasonCode: str(formData, "reasonCode"),
    note: str(formData, "note") || null, targetUserId: str(formData, "targetUserId") || null,
  }); });
}

export async function resolveEscalationAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  const escalationId = str(formData, "escalationId");
  if (!incidentId || !escalationId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await finish(incidentId, () => resolveEscalation(actor, escalationId));
}

export async function cancelEscalationAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  const escalationId = str(formData, "escalationId");
  if (!incidentId || !escalationId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await finish(incidentId, () => cancelEscalation(actor, escalationId));
}
