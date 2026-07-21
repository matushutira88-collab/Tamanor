"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createComplianceRedactionDraft, addComplianceRedactionRule, removeComplianceRedactionRule,
  submitComplianceRedactionDraft, cancelComplianceRedactionDraft, approveComplianceRedactionDraft, rejectComplianceRedactionDraft,
  requestComplianceExportAuthorization, approveComplianceExportAuthorization, rejectComplianceExportAuthorization, cancelComplianceExportAuthorization,
  prepareComplianceExportPackageManifest,
} from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";

/**
 * C12 — server actions for the redaction / four-eyes approval / export workflow.
 * Each delegates to the fail-closed @guardora/db service (permission + scope + four-
 * eyes + validation + transactional audit/history/timeline). Four-eyes is enforced
 * server-side. Errors redirect back with a short, non-revealing CODE.
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const reportPath = (i: string, r: string) => `/dashboard/security/cyberbullying/incidents/${i}/reports/${r}`;
const draftPath = (i: string, r: string, d: string) => `${reportPath(i, r)}/redact/${d}`;

function classify(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  return ["forbidden", "not_found", "invalid_status", "invalid_field", "invalid_action", "invalid_reason", "missing_note", "self_approval", "unresolved_sensitive", "source_stale", "report_not_redacted", "authorization_invalid", "expired", "duplicate"].includes(code ?? "") ? code! : "error";
}
async function back(to: string, run: () => Promise<void>): Promise<never> {
  let err: string | null = null;
  try { await run(); } catch (e) { err = classify(e); }
  revalidatePath(to);
  redirect(err ? `${to}?xerr=${err}` : `${to}?xok=1`);
}

export async function createDraftAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const incidentId = str(fd, "incidentId"), reportId = str(fd, "reportId");
  if (!incidentId || !reportId) redirect("/dashboard/security/cyberbullying/incidents");
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  let draftId: string | null = null, err: string | null = null;
  try { draftId = (await createComplianceRedactionDraft(actor, reportId, { idempotencyKey: str(fd, "idempotencyKey") || null })).draftId; } catch (e) { err = classify(e); }
  revalidatePath(reportPath(incidentId, reportId));
  redirect(draftId ? draftPath(incidentId, reportId, draftId) : `${reportPath(incidentId, reportId)}?xerr=${err ?? "error"}`);
}

export async function addRuleAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r, d] = [str(fd, "incidentId"), str(fd, "reportId"), str(fd, "draftId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(draftPath(i, r, d), () => addComplianceRedactionRule(actor, d, { fieldPath: str(fd, "fieldPath"), action: str(fd, "action"), reasonCode: str(fd, "reasonCode"), reasonNote: str(fd, "reasonNote") || null, replacementMarkerKey: str(fd, "replacementMarkerKey") || null }).then(() => undefined));
}
export async function removeRuleAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r, d] = [str(fd, "incidentId"), str(fd, "reportId"), str(fd, "draftId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(draftPath(i, r, d), () => removeComplianceRedactionRule(actor, d, str(fd, "ruleId")));
}
export async function submitDraftAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r, d] = [str(fd, "incidentId"), str(fd, "reportId"), str(fd, "draftId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(draftPath(i, r, d), () => submitComplianceRedactionDraft(actor, d).then(() => undefined));
}
export async function cancelDraftAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r, d] = [str(fd, "incidentId"), str(fd, "reportId"), str(fd, "draftId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(reportPath(i, r), () => cancelComplianceRedactionDraft(actor, d));
}
export async function approveDraftAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r, d] = [str(fd, "incidentId"), str(fd, "reportId"), str(fd, "draftId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  let produced: string | null = null, err: string | null = null;
  try { produced = (await approveComplianceRedactionDraft(actor, d)).producedReportId; } catch (e) { err = classify(e); }
  revalidatePath(reportPath(i, r));
  redirect(produced ? `${reportPath(i, produced)}?created=1` : `${draftPath(i, r, d)}?xerr=${err ?? "error"}`);
}
export async function rejectDraftAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r, d] = [str(fd, "incidentId"), str(fd, "reportId"), str(fd, "draftId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(draftPath(i, r, d), () => rejectComplianceRedactionDraft(actor, d, str(fd, "reasonCode")));
}

export async function requestAuthAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r] = [str(fd, "incidentId"), str(fd, "reportId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(reportPath(i, r), () => requestComplianceExportAuthorization(actor, r, { purposeCode: str(fd, "purposeCode"), recipientType: str(fd, "recipientType"), recipientLabel: str(fd, "recipientLabel") || null, purposeNote: str(fd, "purposeNote") || null }).then(() => undefined));
}
export async function approveAuthAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r] = [str(fd, "incidentId"), str(fd, "reportId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(reportPath(i, r), () => approveComplianceExportAuthorization(actor, str(fd, "authorizationId")));
}
export async function rejectAuthAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r] = [str(fd, "incidentId"), str(fd, "reportId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(reportPath(i, r), () => rejectComplianceExportAuthorization(actor, str(fd, "authorizationId"), str(fd, "reasonCode")));
}
export async function cancelAuthAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r] = [str(fd, "incidentId"), str(fd, "reportId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(reportPath(i, r), () => cancelComplianceExportAuthorization(actor, str(fd, "authorizationId")));
}
export async function prepareManifestAction(fd: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const [i, r] = [str(fd, "incidentId"), str(fd, "reportId")];
  const actor = { tenantId: s.tenantId, userId: s.userId, role: s.role };
  await back(reportPath(i, r), () => prepareComplianceExportPackageManifest(actor, str(fd, "authorizationId"), { idempotencyKey: str(fd, "idempotencyKey") || null }).then(() => undefined));
}
