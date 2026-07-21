"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateManualReportInput, type ManualReportInput, type ManualReportField, type ManualReportErrorCode } from "@guardora/core";
import { createIncidentFromManualReport } from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { canReportCyberbullying, assertReportableSubject } from "@/server/cyberbullying-report";

/**
 * C6 — the ONE server-side submit for a manual cyberbullying report. It re-checks
 * everything (never trusting the client): session → entitlement → report
 * permission → tenant scope (RLS) → subject scope → full input re-validation →
 * transactional create via the EXISTING `createIncidentFromManualReport` (no
 * parallel create flow). The server alone sets sensitive/system values — domain
 * (cyberbullying), status (open), no reviewer, no detection, no evidence, no
 * auto-confirm. The confidential summary + external reference never enter the
 * audit payload or timeline. Errors are field/form CODES only (UI localizes;
 * nothing internal leaks). Idempotency makes a double-submit yield one incident.
 */

export interface ReportFormState {
  fieldErrors?: Partial<Record<ManualReportField, ManualReportErrorCode>>;
  formError?: "denied" | "locked" | "error";
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function submitManualCyberbullyingReportAction(_prev: ReportFormState, formData: FormData): Promise<ReportFormState> {
  const session = await requireVerifiedSession();
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };

  // (2) entitlement, (3) permission — server is authoritative even if the UI gated.
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return { formError: "locked" };
  if (!canReportCyberbullying(session.role)) return { formError: "denied" };

  // (6) re-validate ALL inputs server-side (client validation is advisory only).
  const input: ManualReportInput = {
    protectedSubjectId: str(formData, "protectedSubjectId"),
    reportSource: str(formData, "reportSource"),
    category: str(formData, "category"),
    summary: String(formData.get("summary") ?? ""),
    allegedActorLabel: str(formData, "allegedActorLabel") || null,
    allegedActorExternalReference: str(formData, "allegedActorExternalReference") || null,
    idempotencyKey: str(formData, "idempotencyKey"),
  };
  const v = validateManualReportInput(input);
  if (!v.ok) return { fieldErrors: v.errors };

  let incidentId: string;
  try {
    // (5) subject scope — fail-closed for missing / inactive / cross-tenant.
    await assertReportableSubject(actor, input.protectedSubjectId);
    // (7-11) transactional create through the single C3 contract. The service sets
    // domain/status/etc.; nothing sensitive here is client-controllable.
    const res = await createIncidentFromManualReport(actor, {
      protectedSubjectId: input.protectedSubjectId,
      summary: input.summary.trim(),
      category: input.category,
      allegedActorLabel: input.allegedActorLabel?.trim() || null,
      allegedActorExternalReference: input.allegedActorExternalReference?.trim() || null,
      idempotencyKey: input.idempotencyKey,
    });
    incidentId = res.incidentId; // same id on a duplicate submit (idempotent)
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "SUBJECT_NOT_ALLOWED") return { fieldErrors: { protectedSubjectId: "invalid" } };
    if (code === "FORBIDDEN") return { formError: "denied" };
    return { formError: "error" };
  }

  revalidatePath("/dashboard/security/cyberbullying/incidents");
  redirect(`/dashboard/security/cyberbullying/report?created=${incidentId}`);
}
