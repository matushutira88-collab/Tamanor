"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { grantGuardianConsent, suspendGuardianConsent, resumeGuardianConsent, revokeGuardianConsent } from "@guardora/db";
import { isConsentType } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";
import { toFamilyConsentErrorCode, type FamilyConsentActionState } from "@/server/family-safe-error";

/**
 * CS-C10 — consent lifecycle server actions (grant / suspend / resume / revoke). Session + FAMILY workspace
 * + ConsentManage capability are server-authoritative; tenantId / actorMembershipId are NEVER read from the
 * client. Consent is bound to (tenant, profile, relationship) and NEVER created implicitly. Only opaque ids
 * + bounded enum values cross the wire. Errors are SAFE consent groups only (never raw message/SQL/id/PII).
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }
const back = (profileId: string, suffix: string) => redirect(`/family/profiles/${profileId}?${suffix}`);

export async function grantConsentAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const guardianRelationshipId = str(formData, "guardianRelationshipId");
  const consentType = str(formData, "consentType");
  const validUntilRaw = str(formData, "validUntil");
  if (!guardianRelationshipId || !isConsentType(consentType)) back(profileId, "e=invalid_state");
  const validUntil = validUntilRaw ? new Date(validUntilRaw) : undefined;
  try { await grantGuardianConsent(actor, { protectedProfileId: profileId, guardianRelationshipId, consentType, validUntil }); }
  catch (e) { back(profileId, `e=${toFamilyConsentErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=consent_granted");
}

export async function resumeConsentAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const consentId = str(formData, "consentId");
  if (!consentId) back(profileId, "e=consent_not_found");
  try { await resumeGuardianConsent(actor, consentId); }
  catch (e) { back(profileId, `e=${toFamilyConsentErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=consent_resumed");
}

/** CS-C10 — DESTRUCTIVE (reversible). `useActionState`-shaped for the confirm dialog. */
export async function suspendConsentAction(_prev: unknown, formData: FormData): Promise<FamilyConsentActionState> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const consentId = str(formData, "consentId");
  if (!consentId) return { ok: false, error: "consent_not_found" };
  try { await suspendGuardianConsent(actor, consentId); }
  catch (e) { return { ok: false, error: toFamilyConsentErrorCode(e) }; }
  revalidatePath(`/family/profiles/${profileId}`);
  redirect(`/family/profiles/${profileId}?ok=consent_suspended`);
}

/** CS-C10 — DESTRUCTIVE (terminal). `useActionState`-shaped for the confirm dialog. */
export async function revokeConsentAction(_prev: unknown, formData: FormData): Promise<FamilyConsentActionState> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const consentId = str(formData, "consentId");
  if (!consentId) return { ok: false, error: "consent_not_found" };
  try { await revokeGuardianConsent(actor, consentId); }
  catch (e) { return { ok: false, error: toFamilyConsentErrorCode(e) }; }
  revalidatePath(`/family/profiles/${profileId}`);
  redirect(`/family/profiles/${profileId}?ok=consent_revoked`);
}
