"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createGuardianRelationship, updateGuardianRole, deactivateGuardianRelationship, reactivateGuardianRelationship } from "@guardora/db";
import { isGuardianRelationshipType, isGuardianAuthorityLevel, isGuardianRole } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";
import { toFamilyActionErrorCode, type FamilyActionState } from "@/server/family-safe-error";

/**
 * CS-C7 — Family guardian-workflow server actions (create / change role / deactivate / reactivate). Session
 * + FAMILY workspace + membership are server-authoritative; tenantId / actorMembershipId are NEVER read from
 * the client. Only opaque ids + bounded enum values cross the wire. The CS-C1/C7 repository re-validates
 * RLS, role, the ACTIVE-primary invariant and the lifecycle transitions. Errors are SAFE codes only.
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }
const back = (profileId: string, suffix: string) => redirect(`/family/profiles/${profileId}?${suffix}`);

export async function createGuardianRelationshipAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const protectedProfileId = str(formData, "protectedProfileId");
  const guardianMembershipId = str(formData, "guardianMembershipId");
  const relationshipType = str(formData, "relationshipType");
  const authorityLevel = str(formData, "authorityLevel");
  const guardianRole = str(formData, "guardianRole");
  if (!protectedProfileId || !guardianMembershipId) back(protectedProfileId || "", "e=not_found");
  if (!isGuardianRelationshipType(relationshipType) || !isGuardianAuthorityLevel(authorityLevel) || !isGuardianRole(guardianRole)) back(protectedProfileId, "e=invalid_state");
  try { await createGuardianRelationship(actor, { guardianMembershipId, protectedProfileId, relationshipType, authorityLevel, guardianRole }); }
  catch (e) { back(protectedProfileId, `e=${toFamilyActionErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${protectedProfileId}`);
  back(protectedProfileId, "ok=guardian_added");
}

export async function updateGuardianRoleAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const relationshipId = str(formData, "relationshipId");
  const guardianRole = str(formData, "guardianRole");
  if (!relationshipId) back(profileId, "e=not_found");
  try { await updateGuardianRole(actor, relationshipId, guardianRole); }
  catch (e) { back(profileId, `e=${toFamilyActionErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=role_changed");
}

export async function reactivateGuardianRelationshipAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const relationshipId = str(formData, "relationshipId");
  if (!relationshipId) back(profileId, "e=not_found");
  try { await reactivateGuardianRelationship(actor, relationshipId); }
  catch (e) { back(profileId, `e=${toFamilyActionErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${profileId}`);
  back(profileId, "ok=guardian_reactivated");
}

/** CS-C7 — DESTRUCTIVE (reversible). `useActionState`-shaped for the confirm dialog. */
export async function deactivateGuardianRelationshipAction(_prev: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  const { actor } = await requireFamilyActor();
  const profileId = str(formData, "profileId");
  const relationshipId = str(formData, "relationshipId");
  if (!relationshipId) return { ok: false, error: "not_found" };
  try { await deactivateGuardianRelationship(actor, relationshipId); }
  catch (e) { return { ok: false, error: toFamilyActionErrorCode(e) }; }
  revalidatePath(`/family/profiles/${profileId}`);
  redirect(`/family/profiles/${profileId}?ok=guardian_deactivated`);
}
