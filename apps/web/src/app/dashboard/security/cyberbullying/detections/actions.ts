"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MANUAL_REPORT_LIMITS } from "@guardora/core";
import { triageDetection, bulkTriageDetections, createIncidentFromDetectionTriage, DetectionTriageError, type SingleTriageOp } from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";

/**
 * C8 — Server Actions for detection triage. Each re-checks the session and delegates
 * to the fail-closed @guardora/db service (permission + tenant scope + transactional
 * audit/timeline). NO automatic incident creation — `create_incident` is an explicit
 * human action with a chosen protected subject. Errors redirect back with a short,
 * non-revealing CODE only.
 */

const QUEUE = "/dashboard/security/cyberbullying/detections";
const SINGLE_OPS = new Set<SingleTriageOp>(["start_review", "ignore", "false_positive", "reopen"]);
const BULK_OPS = new Set(["start_review", "ignore", "false_positive"]);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function classify(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  return code === "forbidden" || code === "not_found" || code === "already_linked" || code === "invalid_transition" ? code : "error";
}

export async function detectionTriageAction(formData: FormData): Promise<void> {
  const session = await requireVerifiedSession();
  const detectionId = str(formData, "detectionId");
  const op = str(formData, "op") as SingleTriageOp;
  const detailPath = `${QUEUE}/${detectionId}`;
  if (!detectionId || !SINGLE_OPS.has(op)) redirect(QUEUE);
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  let err: string | null = null;
  try { await triageDetection(actor, detectionId, op); } catch (e) { err = classify(e); }
  revalidatePath(detailPath);
  redirect(err ? `${detailPath}?err=${err}` : `${detailPath}?ok=1`);
}

export async function bulkTriageAction(formData: FormData): Promise<void> {
  const session = await requireVerifiedSession();
  const op = str(formData, "op");
  const ids = formData.getAll("id").map((v) => String(v)).filter(Boolean);
  if (!BULK_OPS.has(op) || ids.length === 0) redirect(QUEUE);
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  let res = { applied: 0, skipped: 0 };
  let err: string | null = null;
  try { res = await bulkTriageDetections(actor, ids, op as Exclude<SingleTriageOp, "reopen">); } catch (e) { err = classify(e); }
  revalidatePath(QUEUE);
  redirect(err ? `${QUEUE}?err=${err}` : `${QUEUE}?applied=${res.applied}&skipped=${res.skipped}`);
}

export async function createIncidentFromDetectionAction(formData: FormData): Promise<void> {
  const session = await requireVerifiedSession();
  const detectionId = str(formData, "detectionId");
  const protectedSubjectId = str(formData, "protectedSubjectId");
  const summary = str(formData, "summary");
  const detailPath = `${QUEUE}/${detectionId}`;
  if (!detectionId) redirect(QUEUE);
  // Light server-side validation (the confidential summary bounds mirror the report flow).
  if (!protectedSubjectId) { redirect(`${detailPath}?err=subject`); }
  if (summary.length < MANUAL_REPORT_LIMITS.summaryMin || summary.length > MANUAL_REPORT_LIMITS.summaryMax) { redirect(`${detailPath}?err=summary`); }

  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  let incidentId: string | null = null;
  let err: string | null = null;
  try { incidentId = (await createIncidentFromDetectionTriage(actor, detectionId, { protectedSubjectId, summary })).incidentId; }
  catch (e) { err = classify(e); }
  if (incidentId) {
    revalidatePath(detailPath);
    redirect(`/dashboard/security/cyberbullying/incidents/${incidentId}?ok=1`);
  }
  redirect(`${detailPath}?err=${err ?? "error"}`);
}
