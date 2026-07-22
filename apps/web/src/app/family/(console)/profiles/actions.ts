"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProtectedProfile, updateProtectedProfile, restoreProtectedProfile, archiveProtectedProfile } from "@guardora/db";
import { ALL_AGE_BANDS, ProtectionStatus, PROFILE_LANGUAGES } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";
import { toFamilyActionErrorCode, type FamilyActionState } from "@/server/family-safe-error";

/**
 * CS-C6 — Family server actions for protected profiles. Session + FAMILY workspace + membership are all
 * server-authoritative; tenantId / actorMembershipId are NEVER read from the client. Input is allow-listed
 * and enum-validated; the CS-C1 repository enforces RLS + role + archived rules. Errors are safe codes.
 */

function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }

export async function createProtectedProfileAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const guardianLabel = str(formData, "guardianLabel").slice(0, 80) || null;
  const ageBand = str(formData, "ageBand");
  if (!(ALL_AGE_BANDS as readonly string[]).includes(ageBand)) redirect("/family/profiles?e=invalid");
  try {
    await createProtectedProfile(actor, { guardianLabel, ageBand, protectionStatus: ProtectionStatus.Active });
  } catch { redirect("/family/profiles?e=error"); }
  revalidatePath("/family/profiles");
  redirect("/family/profiles?ok=created");
}

/**
 * CS-C6.1 — DESTRUCTIVE. `useActionState`-shaped: returns a SAFE error group on failure (never a raw
 * message/stack/id), and redirects only on success. The confirm happens in an accessible dialog, never
 * `window.confirm`. tenantId / actorMembershipId stay server-authoritative (never from the client).
 */
export async function archiveProtectedProfileAction(_prev: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  const { actor } = await requireFamilyActor();
  const id = str(formData, "profileId");
  if (!id) return { ok: false, error: "not_found" };
  try { await archiveProtectedProfile(actor, id); }
  catch (e) { return { ok: false, error: toFamilyActionErrorCode(e) }; }
  revalidatePath("/family/profiles");
  redirect("/family/profiles?ok=archived");
}

/**
 * CS-C7 — edit a profile's CONTENT-FREE fields (guardianLabel, ageBand, protectionStatus, language). The
 * form NEVER carries a real name/DOB/avatar/note; the repository re-validates the allowlist. On failure it
 * redirects back with a SAFE error code (no raw message). tenantId stays server-authoritative.
 */
export async function updateProtectedProfileAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const id = str(formData, "profileId");
  if (!id) redirect("/family/profiles?e=not_found");
  const ageBand = str(formData, "ageBand");
  const protectionStatus = str(formData, "protectionStatus");
  const languageRaw = str(formData, "language");
  const patch: { guardianLabel?: string | null; ageBand?: string; protectionStatus?: string; language?: string | null } = {
    guardianLabel: str(formData, "guardianLabel").slice(0, 80) || null,
  };
  if (ageBand && (ALL_AGE_BANDS as readonly string[]).includes(ageBand)) patch.ageBand = ageBand;
  if (protectionStatus && Object.values(ProtectionStatus).includes(protectionStatus as ProtectionStatus)) patch.protectionStatus = protectionStatus;
  patch.language = languageRaw && (PROFILE_LANGUAGES as readonly string[]).includes(languageRaw) ? languageRaw : null;
  try { await updateProtectedProfile(actor, id, patch); }
  catch (e) { redirect(`/family/profiles/${id}?e=${toFamilyActionErrorCode(e)}`); }
  revalidatePath(`/family/profiles/${id}`);
  redirect(`/family/profiles/${id}?ok=updated`);
}

/** CS-C7 — restore an archived profile (recovery). `useActionState`-shaped for the confirm dialog. */
export async function restoreProtectedProfileAction(_prev: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  const { actor } = await requireFamilyActor();
  const id = str(formData, "profileId");
  if (!id) return { ok: false, error: "not_found" };
  try { await restoreProtectedProfile(actor, id); }
  catch (e) { return { ok: false, error: toFamilyActionErrorCode(e) }; }
  revalidatePath("/family/profiles");
  revalidatePath(`/family/profiles/${id}`);
  redirect(`/family/profiles/${id}?ok=restored`);
}
