import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireVerifiedSession } from "@/server/auth";

export const metadata: Metadata = { title: "Setup — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * V1.66 — COMPATIBILITY ENTRY into the per-member onboarding flow.
 *
 * Onboarding used to live here as a standalone, tenant-wide wizard: it read `tenants.onboardingCompletedAt`
 * and wrote it on finish, so the first member to complete it silently switched onboarding off for everyone
 * else in the workspace. The flow now lives in the dashboard itself (welcome panel + live setup checklist)
 * and is tracked per membership, so this route only has to hand visitors over to it.
 *
 * It deliberately writes NO onboarding state. A brand-new member arrives at the dashboard still at
 * `not_started` and is greeted there; a member who already dismissed or completed simply lands on the
 * dashboard. Every entry path — new OAuth sign-up, password registration, an old bookmark, a returning
 * member — therefore converges on ONE destination.
 *
 * REDIRECT-LOOP SAFETY: this route always redirects to /dashboard, and /dashboard never redirects back
 * here (it renders the onboarding surface inline), so no cycle can form. `requireVerifiedSession` still
 * routes an unverified visitor into the verification flow exactly as before.
 */
export default async function OnboardingPage() {
  await requireVerifiedSession();
  redirect("/dashboard");
}
