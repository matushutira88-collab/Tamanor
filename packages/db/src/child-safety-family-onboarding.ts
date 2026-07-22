import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import { systemDb } from "./index";
import { FamilyForbiddenError } from "./child-safety-family";
import {
  WorkspaceKind, FamilyRole, familyRoleForMembershipRole,
  WorkspaceOnboardingStep, isWorkspaceOnboardingStep, WORKSPACE_ONBOARDING_AUDIT_EVENTS,
  type FamilyActorContext,
} from "@guardora/core";

/**
 * CS-C6 — Family workspace onboarding state (server-only). FAMILY-gated + PrimaryGuardian for mutations.
 * Content-free (only the safe onboarding step + timestamps). Reuses the tenant onboarding pattern; the
 * step is server-authoritative (never localStorage). No side effects beyond the DB + audit log.
 */

type Tx = Prisma.TransactionClient;

function assertFamily(actor: FamilyActorContext): void {
  if (actor.workspaceKind !== WorkspaceKind.Family) throw new FamilyForbiddenError("not_family_workspace");
}
function assertPrimaryGuardian(actor: FamilyActorContext): void {
  assertFamily(actor);
  if (familyRoleForMembershipRole(actor.role) !== FamilyRole.PrimaryGuardian) throw new FamilyForbiddenError("role_forbidden");
}
async function audit(db: Tx, actor: FamilyActorContext, event: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
  await db.auditLog.create({ data: { tenantId: actor.tenantId, event, actorKind: ActorKind.human, actorUserId: actor.userId, targetType: "workspace_onboarding", targetId: actor.tenantId, metadata: (metadata ?? undefined) as never } });
}

export interface FamilyOnboardingStateVM { currentStep: string; workspaceKind: string; completedAt: Date | null; skippedAt: Date | null }
const ONB_SELECT = { currentStep: true, workspaceKind: true, completedAt: true, skippedAt: true } as const;

/** Read the Family onboarding state (fail-closed to WELCOME if the row is missing). */
export async function getFamilyOnboardingState(actor: FamilyActorContext): Promise<FamilyOnboardingStateVM> {
  assertFamily(actor);
  const row = await withTenant(actor.tenantId, (db) => db.workspaceOnboardingState.findFirst({ where: { tenantId: actor.tenantId }, select: ONB_SELECT }));
  return row ?? { currentStep: WorkspaceOnboardingStep.Welcome, workspaceKind: WorkspaceKind.Family, completedAt: null, skippedAt: null };
}

/** Advance the onboarding wizard to a specific (non-terminal) step. PrimaryGuardian only. */
export async function setFamilyOnboardingStep(actor: FamilyActorContext, step: string): Promise<FamilyOnboardingStateVM> {
  assertPrimaryGuardian(actor);
  if (!isWorkspaceOnboardingStep(step) || step === WorkspaceOnboardingStep.Complete) throw new FamilyForbiddenError("role_forbidden");
  return withTenant(actor.tenantId, async (db) => {
    const row = await db.workspaceOnboardingState.upsert({
      where: { tenantId: actor.tenantId },
      update: { currentStep: step },
      create: { tenantId: actor.tenantId, workspaceKind: WorkspaceKind.Family, currentStep: step },
      select: ONB_SELECT,
    });
    await audit(db, actor, WORKSPACE_ONBOARDING_AUDIT_EVENTS.familyOnboardingStepCompleted, { currentStep: step });
    return row;
  });
}

/** Mark Family onboarding COMPLETE (step=complete + completedAt) and stamp Tenant.onboardingCompletedAt. */
export async function completeFamilyOnboarding(actor: FamilyActorContext): Promise<FamilyOnboardingStateVM> {
  assertPrimaryGuardian(actor);
  const now = new Date();
  const row = await withTenant(actor.tenantId, async (db) => {
    const r = await db.workspaceOnboardingState.upsert({
      where: { tenantId: actor.tenantId },
      update: { currentStep: WorkspaceOnboardingStep.Complete, completedAt: now },
      create: { tenantId: actor.tenantId, workspaceKind: WorkspaceKind.Family, currentStep: WorkspaceOnboardingStep.Complete, completedAt: now },
      select: ONB_SELECT,
    });
    await audit(db, actor, WORKSPACE_ONBOARDING_AUDIT_EVENTS.familyOnboardingCompleted, {});
    return r;
  });
  // Tenant.onboardingCompletedAt is owner-scoped bookkeeping (systemDb, cross-tenant-safe by id).
  await systemDb.tenant.update({ where: { id: actor.tenantId }, data: { onboardingCompletedAt: now } });
  return row;
}
