"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestSafeRecipientAssessment, approveSafeRecipient, rejectSafeRecipient, suspendSafeRecipient, resumeSafeRecipient, expireSafeRecipient, changeSafeRecipientExpiry } from "@guardora/db";
import { isAssessmentPurpose } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";
import { toFamilyAssessmentErrorCode, type FamilyAssessmentActionState } from "@/server/family-safe-error";

/**
 * CS-C11 — safe-recipient assessment lifecycle server actions (request / approve / reject / suspend / resume
 * / expire / change-expiry). Session + FAMILY workspace + SafeRecipientAssess capability are
 * server-authoritative; tenantId / actorMembershipId are NEVER read from the client. The assessment ONLY
 * decides safe-recipient eligibility — it NEVER grants data access. Errors are SAFE groups only.
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }
const back = (profileId: string, suffix: string) => redirect(`/family/profiles/${profileId}?${suffix}`);

export async function requestAssessmentAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const guardianRelationshipId = str(formData, "guardianRelationshipId");
  const purpose = str(formData, "purpose");
  if (!guardianRelationshipId || !isAssessmentPurpose(purpose)) back(profileId, "e=invalid_state");
  try { await requestSafeRecipientAssessment(actor, { guardianRelationshipId, purpose }); }
  catch (e) { back(profileId, `e=${toFamilyAssessmentErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=assessment_requested");
}

export async function approveAssessmentAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const assessmentId = str(formData, "assessmentId");
  const validUntilRaw = str(formData, "validUntil");
  if (!assessmentId) back(profileId, "e=assessment_not_found");
  try { await approveSafeRecipient(actor, assessmentId, validUntilRaw ? { validUntil: new Date(validUntilRaw) } : {}); }
  catch (e) { back(profileId, `e=${toFamilyAssessmentErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=assessment_approved");
}

export async function resumeAssessmentAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const assessmentId = str(formData, "assessmentId");
  if (!assessmentId) back(profileId, "e=assessment_not_found");
  try { await resumeSafeRecipient(actor, assessmentId); }
  catch (e) { back(profileId, `e=${toFamilyAssessmentErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=assessment_resumed");
}

export async function changeAssessmentExpiryAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const assessmentId = str(formData, "assessmentId");
  const validUntilRaw = str(formData, "validUntil");
  if (!assessmentId) back(profileId, "e=assessment_not_found");
  try { await changeSafeRecipientExpiry(actor, assessmentId, validUntilRaw ? new Date(validUntilRaw) : null); }
  catch (e) { back(profileId, `e=${toFamilyAssessmentErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=assessment_expiry_changed");
}

/** CS-C11 — DESTRUCTIVE (reversible). `useActionState`-shaped for the confirm dialog. */
export async function suspendAssessmentAction(_prev: unknown, formData: FormData): Promise<FamilyAssessmentActionState> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const assessmentId = str(formData, "assessmentId");
  if (!assessmentId) return { ok: false, error: "assessment_not_found" };
  try { await suspendSafeRecipient(actor, assessmentId); }
  catch (e) { return { ok: false, error: toFamilyAssessmentErrorCode(e) }; }
  revalidatePath(`/family/profiles/${profileId}`);
  redirect(`/family/profiles/${profileId}?ok=assessment_suspended`);
}

/** CS-C11 — DESTRUCTIVE (terminal). `useActionState`-shaped for the confirm dialog. */
export async function rejectAssessmentAction(_prev: unknown, formData: FormData): Promise<FamilyAssessmentActionState> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const assessmentId = str(formData, "assessmentId");
  if (!assessmentId) return { ok: false, error: "assessment_not_found" };
  try { await rejectSafeRecipient(actor, assessmentId, {}); }
  catch (e) { return { ok: false, error: toFamilyAssessmentErrorCode(e) }; }
  revalidatePath(`/family/profiles/${profileId}`);
  redirect(`/family/profiles/${profileId}?ok=assessment_rejected`);
}

/** CS-C11 — DESTRUCTIVE (terminal). `useActionState`-shaped for the confirm dialog. */
export async function expireAssessmentAction(_prev: unknown, formData: FormData): Promise<FamilyAssessmentActionState> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const assessmentId = str(formData, "assessmentId");
  if (!assessmentId) return { ok: false, error: "assessment_not_found" };
  try { await expireSafeRecipient(actor, assessmentId); }
  catch (e) { return { ok: false, error: toFamilyAssessmentErrorCode(e) }; }
  revalidatePath(`/family/profiles/${profileId}`);
  redirect(`/family/profiles/${profileId}?ok=assessment_expired`);
}
