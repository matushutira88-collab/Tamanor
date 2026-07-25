"use server";

import { revalidatePath } from "next/cache";
import {
  assignChildSafetyIncident, unassignChildSafetyIncident, addChildSafetyReviewerNote, setChildSafetyReviewStatus,
  ChildSafetyReviewForbiddenError, ChildSafetyReviewNotFoundError, type ReviewerActor,
} from "@guardora/db";
import { canManageChildSafetyReview, isChildSafetyReviewStatus, type ChildSafetyReviewStatus } from "@guardora/core";
import { requireVerifiedSession } from "@/server/auth";

/**
 * Reviewer Console — Server Actions for the review lifecycle. Each is fail-closed: it re-resolves the
 * session, re-checks manage permission, and the @guardora/db service re-validates the transition + tenant
 * scope + append-only audit. The client only renders actions the read model marked available; these are
 * the authoritative backstop. On any rejection we return a SAFE, serializable error CODE — never a raw
 * message, SQL, id, or stack. On success we `revalidatePath` so the detail + dashboard cards refresh.
 */
export type ReviewActionState = { ok: true } | { ok: false; error: string };

function classify(e: unknown): string {
  if (e instanceof ChildSafetyReviewForbiddenError) return "forbidden";
  if (e instanceof ChildSafetyReviewNotFoundError) return "not_found";
  const msg = e instanceof Error ? e.message : "";
  if (msg.startsWith("invalid_transition:")) return "invalid_transition";
  if (["assignee_required", "note_empty", "note_too_long", "invalid_status"].includes(msg)) return msg;
  return "retry_later";
}

async function resolveManager(): Promise<ReviewerActor | null> {
  const s = await requireVerifiedSession();
  if (!canManageChildSafetyReview(s.role)) return null;
  return { tenantId: s.tenantId, userId: s.userId, role: s.role };
}

const path = (id: string) => `/dashboard/child-safety/reviewer/${id}`;
async function run(incidentId: string, fn: (actor: ReviewerActor) => Promise<unknown>): Promise<ReviewActionState> {
  const actor = await resolveManager();
  if (!actor) return { ok: false, error: "forbidden" };
  try {
    await fn(actor);
    revalidatePath(path(incidentId));
    revalidatePath("/dashboard/child-safety/reviewer");
    return { ok: true };
  } catch (e) { return { ok: false, error: classify(e) }; }
}

export async function assignAction(_prev: ReviewActionState, fd: FormData): Promise<ReviewActionState> {
  const incidentId = String(fd.get("incidentId") ?? "");
  const assignee = String(fd.get("assigneeUserId") ?? "").trim();
  return run(incidentId, (actor) => assignChildSafetyIncident(actor, incidentId, assignee));
}

export async function assignToMeAction(_prev: ReviewActionState, fd: FormData): Promise<ReviewActionState> {
  const incidentId = String(fd.get("incidentId") ?? "");
  return run(incidentId, (actor) => assignChildSafetyIncident(actor, incidentId, actor.userId));
}

export async function unassignAction(_prev: ReviewActionState, fd: FormData): Promise<ReviewActionState> {
  const incidentId = String(fd.get("incidentId") ?? "");
  return run(incidentId, (actor) => unassignChildSafetyIncident(actor, incidentId));
}

export async function noteAction(_prev: ReviewActionState, fd: FormData): Promise<ReviewActionState> {
  const incidentId = String(fd.get("incidentId") ?? "");
  const body = String(fd.get("body") ?? "");
  return run(incidentId, (actor) => addChildSafetyReviewerNote(actor, incidentId, body));
}

export async function statusAction(_prev: ReviewActionState, fd: FormData): Promise<ReviewActionState> {
  const incidentId = String(fd.get("incidentId") ?? "");
  const to = String(fd.get("status") ?? "");
  if (!isChildSafetyReviewStatus(to)) return { ok: false, error: "invalid_status" };
  return run(incidentId, (actor) => setChildSafetyReviewStatus(actor, incidentId, to as ChildSafetyReviewStatus));
}
