/**
 * Tamanor Child Safety — Family workspace onboarding + registration split FOUNDATION (CS-C6).
 *
 * PURE, crypto-free helpers for the FAMILY/BUSINESS registration split and the Family onboarding
 * lifecycle. The chosen WorkspaceKind is server-authoritative (see workspace.ts) and immutable after
 * creation; this module only provides the allow-listed selection set, the ordered Family onboarding
 * steps, and content-free audit event names. No UI text lives here (see the co-located family-i18n).
 *
 * Client-safe subpath: `@guardora/core/child-safety-onboarding`.
 */

import { WorkspaceKind } from "./workspace";

// --- Registration workspace-kind selection (allow-listed, fail-closed) -------

/** The ONLY workspace kinds a user may pick during public self-service registration. */
export const SELECTABLE_WORKSPACE_KINDS: readonly WorkspaceKind[] = [WorkspaceKind.Family, WorkspaceKind.Business];
export function isSelectableWorkspaceKind(x: unknown): x is WorkspaceKind {
  return typeof x === "string" && (SELECTABLE_WORKSPACE_KINDS as readonly string[]).includes(x);
}

// --- Family onboarding lifecycle --------------------------------------------

/** Ordered Family onboarding steps. `Complete` is terminal. */
export enum WorkspaceOnboardingStep {
  Welcome = "welcome",
  FamilyProfile = "family_profile",
  PrimaryGuardianConfirmation = "primary_guardian_confirmation",
  FirstProtectedProfile = "first_protected_profile",
  PrivacyAndLimits = "privacy_and_limits",
  Complete = "complete",
}
export const FAMILY_ONBOARDING_STEPS: readonly WorkspaceOnboardingStep[] = [
  WorkspaceOnboardingStep.Welcome,
  WorkspaceOnboardingStep.FamilyProfile,
  WorkspaceOnboardingStep.PrimaryGuardianConfirmation,
  WorkspaceOnboardingStep.FirstProtectedProfile,
  WorkspaceOnboardingStep.PrivacyAndLimits,
  WorkspaceOnboardingStep.Complete,
];
export function isWorkspaceOnboardingStep(x: unknown): x is WorkspaceOnboardingStep {
  return typeof x === "string" && (FAMILY_ONBOARDING_STEPS as readonly string[]).includes(x);
}
/** The next step after `current`, or `Complete` if already at/after the end. Fail-closed on unknown. */
export function nextFamilyOnboardingStep(current: string): WorkspaceOnboardingStep {
  const i = (FAMILY_ONBOARDING_STEPS as readonly string[]).indexOf(current);
  if (i < 0) return WorkspaceOnboardingStep.Welcome; // unknown → restart at the beginning (fail-closed)
  return FAMILY_ONBOARDING_STEPS[Math.min(i + 1, FAMILY_ONBOARDING_STEPS.length - 1)] ?? WorkspaceOnboardingStep.Complete;
}
/** Index of a step in the ordered flow (for progress UI). -1 if unknown. */
export function familyOnboardingStepIndex(step: string): number {
  return (FAMILY_ONBOARDING_STEPS as readonly string[]).indexOf(step);
}
export const isFamilyOnboardingComplete = (step: string): boolean => step === WorkspaceOnboardingStep.Complete;

// --- Content-free audit events ----------------------------------------------

export const WORKSPACE_ONBOARDING_AUDIT_EVENTS = {
  workspaceKindSelected: "workspace.kind.selected",
  familyOnboardingStarted: "family.onboarding.started",
  familyOnboardingStepCompleted: "family.onboarding.step_completed",
  familyOnboardingCompleted: "family.onboarding.completed",
  familyProtectedProfileCreated: "family.protected_profile.created",
  familyProtectedProfileUpdated: "family.protected_profile.updated",
  familyProtectedProfileArchived: "family.protected_profile.archived",
} as const;
export type WorkspaceOnboardingAuditEvent = (typeof WORKSPACE_ONBOARDING_AUDIT_EVENTS)[keyof typeof WORKSPACE_ONBOARDING_AUDIT_EVENTS];
