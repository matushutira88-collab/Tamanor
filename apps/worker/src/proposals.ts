import {
  prisma,
  ActorKind,
  DecisionStatus,
  ModerationAction,
  ReputationStatus,
  RiskLevel,
} from "@guardora/db";
import { log } from "./logger";

/**
 * Auto-execution is DISABLED in V1.1. The worker may only PROPOSE actions for
 * human approval — it never approves or executes anything. This flag exists so
 * the intent is explicit and greppable; it must stay false until a later phase.
 */
export const AUTO_EXECUTION_ENABLED = false;

/**
 * Find high/critical-risk items that are still in triage and have no open
 * proposal, and create a PROPOSED hide for each (mock, proposed by AI). Every
 * proposal is audited. Nothing is executed.
 */
export async function proposeForHighRiskItems(limit = 20): Promise<number> {
  const items = await prisma.reputationItem.findMany({
    where: {
      riskLevel: { in: [RiskLevel.high, RiskLevel.critical] },
      status: { in: [ReputationStatus.new, ReputationStatus.classified] },
      decisions: {
        none: {
          status: { in: [DecisionStatus.proposed, DecisionStatus.approved] },
        },
      },
    },
    take: limit,
  });

  let created = 0;
  for (const item of items) {
    await prisma.moderationDecision.create({
      data: {
        tenantId: item.tenantId,
        brandId: item.brandId,
        reputationItemId: item.id,
        action: ModerationAction.hide,
        status: DecisionStatus.proposed,
        proposedByKind: ActorKind.ai,
        confidence: item.riskConfidence,
        riskSnapshot: {
          level: item.riskLevel,
          confidence: item.riskConfidence,
          categories: item.riskCategories,
          sentiment: item.sentiment,
        },
        reason:
          "Auto-proposed by worker for high-risk item (mock — awaiting human approval, not executed).",
      },
    });

    await prisma.reputationItem.update({
      where: { id: item.id },
      data: { status: ReputationStatus.needs_approval, requiresApproval: true },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: item.tenantId,
        brandId: item.brandId,
        event: "proposal.created",
        actorKind: ActorKind.system,
        targetType: "reputation_item",
        targetId: item.id,
        metadata: { action: "hide", proposedBy: "ai", auto: true },
      },
    });

    created++;
  }

  if (created > 0) {
    log.info("worker.proposals.created", {
      created,
      autoExecution: AUTO_EXECUTION_ENABLED,
    });
  }
  return created;
}
