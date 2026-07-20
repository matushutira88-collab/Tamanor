"use server";

/**
 * V1.66 — server actions for the PER-MEMBER onboarding flow.
 *
 * Every action derives the actor from the validated session — the client never supplies a userId or
 * tenantId, so one member can never move another member's onboarding. Invalid state transitions are
 * rejected in the DB layer; here they are swallowed into a no-op refresh (a double-click or a stale tab
 * must not throw a render error at the user). Nothing tenant-wide is ever written: the legacy
 * `Tenant.onboardingCompletedAt` is left untouched.
 */

import { revalidatePath } from "next/cache";
import {
  applyOnboardingAction, acknowledgeOnboarding, getOnboardingState, maybeAutoComplete,
  OnboardingTransitionError, OnboardingRequirementsError,
  type OnboardingAction, type OnboardingState,
} from "@guardora/db";
import { emitOpsEvent, type OpsEvent } from "@guardora/core";
import { requireVerifiedSession } from "@/server/auth";

const EVENT: Record<OnboardingAction, OpsEvent> = {
  start: "onboarding.started",
  dismiss: "onboarding.dismissed",
  resume: "onboarding.resumed",
  complete: "onboarding.completed",
  restart: "onboarding.restarted",
};

/**
 * Apply one action for the CURRENT member. Safe meta only: ids, the onboarding version and a numeric
 * progress count — never the checklist payload, a comment, a message or any e-mail content.
 */
async function run(action: OnboardingAction): Promise<void> {
  const session = await requireVerifiedSession();
  try {
    const state = await applyOnboardingAction(session.tenantId, session.userId, action);
    if (state) {
      emitOpsEvent(EVENT[action], {
        userId: session.userId,
        tenantId: session.tenantId,
        onboardingVersion: state.version,
        completedSteps: state.completedCount,
        totalSteps: state.totalCount,
      });
    }
  } catch (e) {
    // A rejected transition is expected under races (double submit, stale tab) — never a user-facing error.
    if (!(e instanceof OnboardingTransitionError) && !(e instanceof OnboardingRequirementsError)) throw e;
  }
  revalidatePath("/dashboard");
}

export async function startOnboarding(): Promise<void> { await run("start"); }
export async function dismissOnboarding(): Promise<void> { await run("dismiss"); }
export async function resumeOnboarding(): Promise<void> { await run("resume"); }
export async function restartOnboarding(): Promise<void> { await run("restart"); }

/** Record that this member has seen the welcome screen (allow-listed boolean; no PII). */
export async function acknowledgeWelcome(): Promise<void> {
  const session = await requireVerifiedSession();
  await acknowledgeOnboarding(session.tenantId, session.userId, "welcome_seen");
}

/**
 * Read the current member's onboarding state for a server component, auto-completing first when every
 * REQUIRED step is genuinely satisfied. Fail-open: onboarding is an aid, so a failure here must never
 * take the dashboard down — the caller simply renders no onboarding surface.
 */
export async function loadOnboarding(tenantId: string, userId: string): Promise<OnboardingState | null> {
  try {
    if (await maybeAutoComplete(tenantId, userId)) {
      const done = await getOnboardingState(tenantId, userId);
      emitOpsEvent("onboarding.completed", {
        userId, tenantId,
        onboardingVersion: done?.version ?? 0,
        completedSteps: done?.completedCount ?? 0,
        totalSteps: done?.totalCount ?? 0,
      });
      return done;
    }
    return await getOnboardingState(tenantId, userId);
  } catch {
    return null;
  }
}
