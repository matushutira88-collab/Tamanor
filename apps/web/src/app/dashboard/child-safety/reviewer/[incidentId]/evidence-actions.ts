"use server";

import { revalidatePath } from "next/cache";
import {
  createChildSafetyEvidence, verifyChildSafetyEvidenceIntegrity, sealChildSafetyEvidence,
  ChildSafetyEvidenceForbiddenError, ChildSafetyEvidenceNotFoundError, type EvidenceActor,
} from "@guardora/db";
import { canManageChildSafetyEvidence, isChildSafetyEvidenceType, ChildSafetyEvidenceType, CHILD_SAFETY_EVIDENCE_MAX_BYTES } from "@guardora/core";
import { requireVerifiedSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";

/**
 * Evidence Management — Server Actions (upload / verify / seal). Fail-closed: same-origin (CSRF) +
 * evidence MANAGE permission re-checked here, and the @guardora/db service re-validates tenant scope +
 * appends the chain-of-custody event + audit. Returns a SAFE, serializable error CODE only. On success it
 * revalidates the detail page so the evidence list + custody refresh. There is NO edit and NO delete action.
 */
export type EvidenceActionState = { ok: true } | { ok: false; error: string };

function classify(e: unknown): string {
  if (e instanceof ChildSafetyEvidenceForbiddenError) return "forbidden";
  if (e instanceof ChildSafetyEvidenceNotFoundError) return "not_found";
  const msg = e instanceof Error ? e.message : "";
  if (["invalid_type", "invalid_url", "file_required", "file_too_large", "text_required", "text_too_long"].includes(msg)) return msg;
  return "retry_later";
}

async function resolveManager(): Promise<EvidenceActor | null> {
  const s = await requireVerifiedSession();
  if (!canManageChildSafetyEvidence(s.role)) return null;
  return { tenantId: s.tenantId, userId: s.userId, role: s.role };
}
const path = (id: string) => `/dashboard/child-safety/reviewer/${id}`;
async function run(incidentId: string, fn: (a: EvidenceActor) => Promise<unknown>): Promise<EvidenceActionState> {
  if (!(await isSameOrigin())) return { ok: false, error: "forbidden" };
  const actor = await resolveManager();
  if (!actor) return { ok: false, error: "forbidden" };
  try { await fn(actor); revalidatePath(path(incidentId)); return { ok: true }; }
  catch (e) { return { ok: false, error: classify(e) }; }
}

export async function uploadEvidenceAction(_prev: EvidenceActionState, fd: FormData): Promise<EvidenceActionState> {
  const incidentId = String(fd.get("incidentId") ?? "");
  const type = String(fd.get("type") ?? "");
  if (!isChildSafetyEvidenceType(type)) return { ok: false, error: "invalid_type" };
  const label = String(fd.get("label") ?? "").trim() || undefined;
  return run(incidentId, async (actor) => {
    if (type === ChildSafetyEvidenceType.UploadedFile || type === ChildSafetyEvidenceType.Screenshot) {
      const file = fd.get("file");
      if (!(file instanceof File) || file.size === 0) throw new Error("file_required");
      if (file.size > CHILD_SAFETY_EVIDENCE_MAX_BYTES) throw new Error("file_too_large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      return createChildSafetyEvidence(actor, { incidentId, type, label, bytes, mimeType: file.type || "application/octet-stream" });
    }
    if (type === ChildSafetyEvidenceType.ExternalUrl) return createChildSafetyEvidence(actor, { incidentId, type, label, url: String(fd.get("url") ?? "") });
    return createChildSafetyEvidence(actor, { incidentId, type, label, bodyText: String(fd.get("bodyText") ?? "") });
  });
}

export async function verifyEvidenceAction(_prev: EvidenceActionState, fd: FormData): Promise<EvidenceActionState> {
  const incidentId = String(fd.get("incidentId") ?? "");
  const evidenceId = String(fd.get("evidenceId") ?? "");
  return run(incidentId, (actor) => verifyChildSafetyEvidenceIntegrity(actor, evidenceId));
}

export async function sealEvidenceAction(_prev: EvidenceActionState, fd: FormData): Promise<EvidenceActionState> {
  const incidentId = String(fd.get("incidentId") ?? "");
  const evidenceId = String(fd.get("evidenceId") ?? "");
  return run(incidentId, (actor) => sealChildSafetyEvidence(actor, evidenceId, "reviewer_seal"));
}
