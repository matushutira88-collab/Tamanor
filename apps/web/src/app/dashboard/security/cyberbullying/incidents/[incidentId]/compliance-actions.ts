"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCyberbullyingComplianceReport } from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";

/**
 * C11 — create an immutable compliance report snapshot. Fail-closed: session →
 * entitlement → the @guardora/db service (permission + incident scope + versioning +
 * hashing + idempotency). No notification is created. On success it redirects to the
 * new read-only report; on failure, back with a safe code.
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const path = (id: string) => `/dashboard/security/cyberbullying/incidents/${id}`;

function classify(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  return ["forbidden", "not_found", "unsupported_type", "duplicate_version", "source_too_large"].includes(code ?? "") ? code! : "error";
}

export async function createComplianceReportAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  if (!incidentId) redirect("/dashboard/security/cyberbullying/incidents");
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) redirect(`${path(incidentId)}?rerr=locked#reports`);

  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  let reportId: string | null = null;
  let err: string | null = null;
  try {
    const res = await createCyberbullyingComplianceReport(actor, incidentId, { reportType: str(formData, "reportType"), idempotencyKey: str(formData, "idempotencyKey") || null });
    reportId = res.reportId;
  } catch (e) { err = classify(e); }

  revalidatePath(path(incidentId));
  if (reportId) redirect(`${path(incidentId)}/reports/${reportId}?created=1`);
  redirect(`${path(incidentId)}?rerr=${err ?? "error"}#reports`);
}
