/**
 * Child Safety Evidence — web server glue. Resolves the authenticated session into an evidence actor and
 * maps thrown service errors to safe, stable HTTP codes. Reads require review VIEW; writes require evidence
 * MANAGE (enforced again in the service). Storage keys/paths are never exposed. All access is Owner /
 * Administrator / Safety Reviewer only.
 */
import { type EvidenceActor, ChildSafetyEvidenceForbiddenError, ChildSafetyEvidenceNotFoundError } from "@guardora/db";
import { canViewChildSafetyEvidence } from "@guardora/core";
import { getSession } from "@/server/auth";

/** Resolve a verified session to an evidence actor, or null when unauthenticated / not a reviewer. */
export async function resolveEvidenceActor(): Promise<EvidenceActor | null> {
  const s = await getSession();
  if (!s || !s.emailVerified) return null;
  if (!canViewChildSafetyEvidence(s.role)) return null;
  return { tenantId: s.tenantId, userId: s.userId, role: s.role };
}

/** Map a thrown evidence error to a safe { status, code }. Never leaks a message/stack/id. */
export function mapEvidenceError(e: unknown): { status: number; code: string } {
  if (e instanceof ChildSafetyEvidenceForbiddenError) return { status: 403, code: "forbidden" };
  if (e instanceof ChildSafetyEvidenceNotFoundError) return { status: 404, code: "not_found" };
  const msg = e instanceof Error ? e.message : "";
  if (["not_downloadable", "no_evidence", "invalid_type", "invalid_url", "file_required", "file_too_large", "text_required", "text_too_long"].includes(msg)) return { status: 400, code: msg };
  return { status: 500, code: "internal" };
}
