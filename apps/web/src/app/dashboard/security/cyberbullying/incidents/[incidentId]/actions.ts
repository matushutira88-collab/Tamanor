"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IncidentLifecycleStatus } from "@guardora/core";
import {
  transitionIncident, reopenIncident, assignReviewer, unassignReviewer, addReviewerNote,
} from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";

/**
 * C5 — Server Actions for the operational incident page. Each is fail-closed: the
 * @guardora/db service re-validates lifecycle + permission + tenant/subject scope
 * and runs transactionally with an audit log + append-only timeline. The UI only
 * renders actions the read model marked available; these actions are the
 * server-side backstop. On any rejection we redirect back with a short, non-
 * revealing error CODE — never a raw message, SQL, id, or stack.
 */

const INCIDENTS = "/dashboard/security/cyberbullying/incidents";

// The lifecycle targets reachable from a button. `reopen` is a separate action.
const TARGETS = new Set<string>([
  IncidentLifecycleStatus.UnderReview,
  IncidentLifecycleStatus.Acknowledged,
  IncidentLifecycleStatus.Confirmed,
  IncidentLifecycleStatus.ActionRequired,
  IncidentLifecycleStatus.Resolved,
  IncidentLifecycleStatus.Dismissed,
  IncidentLifecycleStatus.Archived,
]);

/** Map any thrown error to a short, safe code. Never leaks internals. */
function classify(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case "FORBIDDEN": return "forbidden";
    case "NOT_FOUND": return "not_found";
    case "TRANSITION_REJECTED": return "transition";
    case "ASSIGNMENT_REJECTED": return "assignment";
    default: return "error";
  }
}

function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }

/** Perform `run`, then always redirect back to the detail page (err code on failure). */
async function finish(incidentId: string, run: () => Promise<void>): Promise<never> {
  const path = `${INCIDENTS}/${incidentId}`;
  let err: string | null = null;
  try { await run(); } catch (e) { err = classify(e); }
  revalidatePath(path);
  redirect(err ? `${path}?err=${err}` : `${path}?ok=1`);
}

export async function transitionIncidentAction(formData: FormData): Promise<void> {
  const session = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  const to = str(formData, "to");
  const reason = str(formData, "reason") || undefined;
  if (!incidentId) redirect(INCIDENTS);
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  await finish(incidentId, async () => {
    if (!TARGETS.has(to)) throw { code: "TRANSITION_REJECTED" };
    await transitionIncident(actor, incidentId, to as IncidentLifecycleStatus, reason);
  });
}

export async function reopenIncidentAction(formData: FormData): Promise<void> {
  const session = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  const reason = str(formData, "reason");
  if (!incidentId) redirect(INCIDENTS);
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  await finish(incidentId, async () => { await reopenIncident(actor, incidentId, reason); });
}

export async function assignReviewerAction(formData: FormData): Promise<void> {
  const session = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  // `assignee` optional — when absent the actor claims the case for themselves.
  const assignee = str(formData, "assignee") || session.userId;
  const reason = str(formData, "reason") || undefined;
  if (!incidentId) redirect(INCIDENTS);
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  await finish(incidentId, async () => { await assignReviewer(actor, incidentId, assignee, reason); });
}

export async function unassignReviewerAction(formData: FormData): Promise<void> {
  const session = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  const reason = str(formData, "reason") || undefined;
  if (!incidentId) redirect(INCIDENTS);
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  await finish(incidentId, async () => { await unassignReviewer(actor, incidentId, reason); });
}

export async function addReviewerNoteAction(formData: FormData): Promise<void> {
  const session = await requireVerifiedSession();
  const incidentId = str(formData, "incidentId");
  const body = str(formData, "body");
  if (!incidentId) redirect(INCIDENTS);
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  await finish(incidentId, async () => { await addReviewerNote(actor, incidentId, body); });
}
