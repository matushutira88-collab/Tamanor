"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { grantGuardianAuthority, changeGuardianAuthorityLevel, suspendGuardianAuthority, resumeGuardianAuthority, revokeGuardianAuthority } from "@guardora/db";
import { isGuardianAuthorityType, isGuardianAuthorityLevel } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";
import { toFamilyAuthorityErrorCode, type FamilyAuthorityActionState } from "@/server/family-safe-error";

/**
 * CS-C9 — guardian AUTHORITY lifecycle server actions (grant / change level / suspend / resume / revoke).
 * Session + FAMILY workspace + PrimaryGuardian capability are server-authoritative; tenantId /
 * actorMembershipId are NEVER read from the client. Only opaque ids + bounded enum values (+ a bounded
 * attestation flag) cross the wire. The repository re-checks every precondition and forbids self-management.
 * Errors are SAFE authority groups only (never raw message/stack/SQL/id/PII/authorization chain).
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }
const back = (profileId: string, suffix: string) => redirect(`/family/profiles/${profileId}?${suffix}`);

export async function grantGuardianAuthorityAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const guardianRelationshipId = str(formData, "guardianRelationshipId");
  const authorityType = str(formData, "authorityType");
  const authorityLevel = str(formData, "authorityLevel");
  const attestation = str(formData, "attestation") === "on" || str(formData, "attestation") === "true";
  const validUntilRaw = str(formData, "validUntil");
  if (!guardianRelationshipId || !isGuardianAuthorityType(authorityType) || !isGuardianAuthorityLevel(authorityLevel)) back(profileId, "e=invalid_state");
  const validUntil = validUntilRaw ? new Date(validUntilRaw) : undefined;
  try { await grantGuardianAuthority(actor, { guardianRelationshipId, authorityType, authorityLevel, attestation, validUntil }); }
  catch (e) { back(profileId, `e=${toFamilyAuthorityErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=authority_granted");
}

export async function changeGuardianAuthorityLevelAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const authorityId = str(formData, "authorityId");
  const authorityLevel = str(formData, "authorityLevel");
  if (!authorityId) back(profileId, "e=authority_not_found");
  try { await changeGuardianAuthorityLevel(actor, authorityId, authorityLevel); }
  catch (e) { back(profileId, `e=${toFamilyAuthorityErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=authority_changed");
}

export async function resumeGuardianAuthorityAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const authorityId = str(formData, "authorityId");
  if (!authorityId) back(profileId, "e=authority_not_found");
  try { await resumeGuardianAuthority(actor, authorityId); }
  catch (e) { back(profileId, `e=${toFamilyAuthorityErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=authority_resumed");
}

/** CS-C9 — DESTRUCTIVE (reversible). `useActionState`-shaped for the confirm dialog. */
export async function suspendGuardianAuthorityAction(_prev: unknown, formData: FormData): Promise<FamilyAuthorityActionState> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const authorityId = str(formData, "authorityId");
  if (!authorityId) return { ok: false, error: "authority_not_found" };
  try { await suspendGuardianAuthority(actor, authorityId); }
  catch (e) { return { ok: false, error: toFamilyAuthorityErrorCode(e) }; }
  revalidatePath(`/family/profiles/${profileId}`);
  redirect(`/family/profiles/${profileId}?ok=authority_suspended`);
}

/** CS-C9 — DESTRUCTIVE (terminal). `useActionState`-shaped for the confirm dialog. */
export async function revokeGuardianAuthorityAction(_prev: unknown, formData: FormData): Promise<FamilyAuthorityActionState> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const authorityId = str(formData, "authorityId");
  if (!authorityId) return { ok: false, error: "authority_not_found" };
  try { await revokeGuardianAuthority(actor, authorityId); }
  catch (e) { return { ok: false, error: toFamilyAuthorityErrorCode(e) }; }
  revalidatePath(`/family/profiles/${profileId}`);
  redirect(`/family/profiles/${profileId}?ok=authority_revoked`);
}
