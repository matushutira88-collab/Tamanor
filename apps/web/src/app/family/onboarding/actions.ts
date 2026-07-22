"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setFamilyOnboardingStep, completeFamilyOnboarding, createProtectedProfile } from "@guardora/db";
import { WorkspaceOnboardingStep, FAMILY_ONBOARDING_STEPS, nextFamilyOnboardingStep, ALL_AGE_BANDS, ProtectionStatus } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";

/**
 * CS-C6 — Family onboarding wizard actions. Server-authoritative step (never localStorage). Step 4
 * creates the first ProtectedProfile through the CS-C1 repository. Onboarding never asks for platform
 * credentials, phone, device id or messages. PrimaryGuardian is enforced by the repository.
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }

export async function familyOnboardingAdvanceAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const current = str(formData, "currentStep");

  // Step 4 — create the first protected profile via CS-C1 (no social/phone/message fields).
  if (current === WorkspaceOnboardingStep.FirstProtectedProfile) {
    const guardianLabel = str(formData, "guardianLabel").slice(0, 80) || null;
    const ageBand = str(formData, "ageBand");
    if (!(ALL_AGE_BANDS as readonly string[]).includes(ageBand)) redirect("/family/onboarding?e=invalid");
    try { await createProtectedProfile(actor, { guardianLabel, ageBand, protectionStatus: ProtectionStatus.Active }); }
    catch { redirect("/family/onboarding?e=error"); }
  }

  const next = nextFamilyOnboardingStep(current);
  if (next === WorkspaceOnboardingStep.Complete) {
    await completeFamilyOnboarding(actor);
    redirect("/family");
  }
  try { await setFamilyOnboardingStep(actor, next); }
  catch { redirect("/family/onboarding?e=error"); }
  revalidatePath("/family/onboarding");
  redirect("/family/onboarding");
}

export async function familyOnboardingBackAction(formData: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const current = str(formData, "currentStep");
  const i = (FAMILY_ONBOARDING_STEPS as readonly string[]).indexOf(current);
  const prev = FAMILY_ONBOARDING_STEPS[Math.max(0, i - 1)] ?? WorkspaceOnboardingStep.Welcome;
  try { await setFamilyOnboardingStep(actor, prev); } catch { /* no-op */ }
  revalidatePath("/family/onboarding");
  redirect("/family/onboarding");
}
