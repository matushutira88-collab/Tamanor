import "server-only";
import { can, Role, Permission, canAttachEvidenceToStatus } from "@guardora/core";
import { getCyberbullyingIncidentDetail } from "./cyberbullying-inbox";

/**
 * C7 — server-side gate + context for the evidence upload surface. Upload requires
 * `cyberbullying:review` (Owner/Admin/Reviewer); auditor/viewer are read-only. The
 * context reuses the scope-aware detail read model, so a user who can't see the
 * incident can't reach its upload form.
 */

export type EvidenceActor = { tenantId: string; userId: string; role: string };

export function canUploadEvidence(role: string): boolean {
  return can(role as Role, Permission.CyberbullyingReview);
}

export interface EvidenceUploadContext {
  incidentId: string;
  status: string;
  subjectLabel: string | null;
  /** Lifecycle allows attaching evidence (open/under_review/acknowledged/confirmed/action_required). */
  canAttach: boolean;
  evidenceCount: number;
}

/** Verify access (subject scope) + return the upload context, or null if not accessible. */
export async function getEvidenceUploadContext(actor: EvidenceActor, incidentId: string): Promise<EvidenceUploadContext | null> {
  const inc = await getCyberbullyingIncidentDetail(actor, incidentId);
  if (!inc) return null;
  return {
    incidentId: inc.id,
    status: inc.status,
    subjectLabel: inc.subjectLabel,
    canAttach: canAttachEvidenceToStatus(inc.status),
    evidenceCount: inc.evidence.length,
  };
}
