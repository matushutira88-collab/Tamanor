"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProtectedProfile, archiveProtectedProfile } from "@guardora/db";
import { ALL_AGE_BANDS, ProtectionStatus } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";

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

export async function archiveProtectedProfileAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const id = str(formData, "profileId");
  if (!id) redirect("/family/profiles?e=invalid");
  try { await archiveProtectedProfile(actor, id); }
  catch { redirect("/family/profiles?e=error"); }
  revalidatePath("/family/profiles");
  redirect("/family/profiles?ok=archived");
}
