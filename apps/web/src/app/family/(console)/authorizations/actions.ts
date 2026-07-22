"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revokeRecipientAuthorizationDecision, createRecipientAuthorizationDecision, evaluateRecipientAuthorization } from "@guardora/db";
import { requireFamilyActor } from "@/server/family-guard";
import { toFamilyActionErrorCode, type FamilyActionState } from "@/server/family-safe-error";

/**
 * CS-C6 — Family server actions for recipient authorization decisions (CS-C4). Session + FAMILY +
 * membership are server-authoritative; tenantId / actorMembershipId are NEVER from the client. The
 * CS-C4 repository enforces RLS + FamilyRole + the full authorization chain + self-authorization rule.
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }

/**
 * CS-C6.1 — DESTRUCTIVE. `useActionState`-shaped: returns a SAFE error group on failure and redirects only
 * on success. Confirmed in an accessible dialog (never `window.confirm`); the actor is server-authoritative.
 */
export async function revokeRecipientAuthorizationDecisionAction(_prev: unknown, formData: FormData): Promise<FamilyActionState> {
  const { actor } = await requireFamilyActor();
  const id = str(formData, "decisionId");
  if (!id) return { ok: false, error: "not_found" };
  try { await revokeRecipientAuthorizationDecision(actor, id); }
  catch (e) { return { ok: false, error: toFamilyActionErrorCode(e) }; }
  revalidatePath("/family/authorizations");
  redirect("/family/authorizations?ok=revoked");
}

export async function evaluateRecipientAuthorizationAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const safetySignalId = str(formData, "safetySignalId");
  const recipientMembershipId = str(formData, "recipientMembershipId");
  const guardianRelationshipId = str(formData, "guardianRelationshipId");
  if (!safetySignalId || !recipientMembershipId || !guardianRelationshipId) redirect("/family/authorizations?e=invalid");
  try { await evaluateRecipientAuthorization(actor, { safetySignalId, recipientMembershipId, guardianRelationshipId }); }
  catch { redirect("/family/authorizations?e=error"); }
  redirect("/family/authorizations?ok=evaluated");
}

export async function createRecipientAuthorizationDecisionAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const safetySignalId = str(formData, "safetySignalId");
  const recipientMembershipId = str(formData, "recipientMembershipId");
  const guardianRelationshipId = str(formData, "guardianRelationshipId");
  if (!safetySignalId || !recipientMembershipId || !guardianRelationshipId) redirect("/family/authorizations?e=invalid");
  try { await createRecipientAuthorizationDecision(actor, { safetySignalId, recipientMembershipId, guardianRelationshipId }); }
  catch { redirect("/family/authorizations?e=error"); }
  revalidatePath("/family/authorizations");
  redirect("/family/authorizations?ok=created");
}
