"use server";

import { redirect } from "next/navigation";
import { markOnboardingComplete } from "@guardora/db";
import { requireSession } from "@/server/auth";

/**
 * V1.50B — finish (or skip) onboarding: persist the workspace's onboarding state so the
 * wizard is shown once, then continue to the dashboard. Idempotent.
 */
export async function completeOnboarding(): Promise<void> {
  const session = await requireSession();
  await markOnboardingComplete(session.tenantId);
  redirect("/dashboard");
}
