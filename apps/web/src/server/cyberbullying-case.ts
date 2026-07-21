import "server-only";
import { withTenant } from "@guardora/db";
import { can, Role, Permission, CaseMilestoneKey } from "@guardora/core";
import { getCyberbullyingIncidentDetail } from "./cyberbullying-inbox";

/**
 * C9 — server-side READ MODEL for case management (a case IS the incident). Reuses
 * the scope-aware incident detail read model to enforce access, then returns a
 * sanitized VIEW-MODEL of the 1:1 Protection Plan (risk/status/objective/notes),
 * follow-up, manually-toggled milestones, and Case Tasks. Never a raw Prisma row.
 */

export type CaseActor = { tenantId: string; userId: string; role: string };

/** Writing case management requires `cyberbullying:review` (Owner/Admin/Reviewer). */
export function canManageCase(role: string): boolean {
  return can(role as Role, Permission.CyberbullyingReview);
}

export interface CaseTaskVM { id: string; title: string; description: string | null; status: string; assigneeUserId: string | null; dueDate: string | null; completedAt: string | null }
export interface CaseManagementView {
  protection: { riskLevel: string | null; protectionStatus: string; objective: string | null; notes: string | null };
  followUp: { nextReviewAt: string | null; lastReviewAt: string | null; followUpNotes: string | null };
  milestones: Record<string, boolean>;
  tasks: CaseTaskVM[];
  canManage: boolean;
}

export async function getCaseManagementView(actor: CaseActor, incidentId: string): Promise<CaseManagementView | null> {
  // Access + scope: if the caller can't see the incident, there's no case view.
  const inc = await getCyberbullyingIncidentDetail(actor, incidentId);
  if (!inc) return null;

  return withTenant(actor.tenantId, async (db) => {
    const [plan, tasks] = await Promise.all([
      db.cyberbullyingProtectionPlan.findFirst({ where: { incidentId, tenantId: actor.tenantId }, select: {
        riskLevel: true, protectionStatus: true, objective: true, notes: true,
        nextReviewAt: true, lastReviewAt: true, followUpNotes: true,
        milestoneInitialReviewAt: true, milestoneEvidenceCollectedAt: true, milestoneVictimContactedAt: true, milestoneProtectionActiveAt: true, milestoneResolvedAt: true,
      } }),
      db.cyberbullyingCaseTask.findMany({ where: { incidentId, tenantId: actor.tenantId }, orderBy: { createdAt: "asc" }, select: {
        id: true, title: true, description: true, status: true, assigneeUserId: true, dueDate: true, completedAt: true,
      } }),
    ]);
    return {
      protection: { riskLevel: plan?.riskLevel ?? null, protectionStatus: plan?.protectionStatus ?? "not_started", objective: plan?.objective ?? null, notes: plan?.notes ?? null },
      followUp: { nextReviewAt: plan?.nextReviewAt?.toISOString() ?? null, lastReviewAt: plan?.lastReviewAt?.toISOString() ?? null, followUpNotes: plan?.followUpNotes ?? null },
      milestones: {
        [CaseMilestoneKey.InitialReview]: !!plan?.milestoneInitialReviewAt,
        [CaseMilestoneKey.EvidenceCollected]: !!plan?.milestoneEvidenceCollectedAt,
        [CaseMilestoneKey.VictimContacted]: !!plan?.milestoneVictimContactedAt,
        [CaseMilestoneKey.ProtectionActive]: !!plan?.milestoneProtectionActiveAt,
        [CaseMilestoneKey.Resolved]: !!plan?.milestoneResolvedAt,
      },
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, status: t.status, assigneeUserId: t.assigneeUserId, dueDate: t.dueDate?.toISOString() ?? null, completedAt: t.completedAt?.toISOString() ?? null })),
      canManage: canManageCase(actor.role),
    };
  });
}
