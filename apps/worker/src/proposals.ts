import {
  ActorKind,
  DecisionStatus,
  ModerationAction,
  ReputationStatus,
  findItemsForProposal,
} from "@guardora/db";
import { log } from "./logger";
import { newCorrelationId, runTenantJob, type TenantWorkerJob } from "./job";

/**
 * Auto-execution is DISABLED in V1.1. The worker may only PROPOSE actions for
 * human approval — it never approves or executes anything. This flag exists so
 * the intent is explicit and greppable; it must stay false until a later phase.
 */
export const AUTO_EXECUTION_ENABLED = false;

/**
 * V1.37.3B — system discovery finds high/critical items still in triage (trusted
 * tenantId), then each proposal is written under the item's tenant context via RLS
 * (withTenantDb). The worker never proposes across tenants and never writes with
 * the owner client.
 */
export async function proposeForHighRiskItems(limit = 20): Promise<number> {
  const candidates = await findItemsForProposal(limit);

  let created = 0;
  for (const c of candidates) {
    const job: TenantWorkerJob = {
      jobType: "propose",
      tenantId: c.tenantId,
      brandId: c.brandId,
      reputationItemId: c.id,
      correlationId: newCorrelationId("propose"),
    };

    const res = await runTenantJob(job, async ({ db }) => {
      // Re-read under RLS: confirms tenant ownership AND the item is still eligible
      // (guards against a race where a proposal appeared since discovery).
      const item = await db.reputationItem.findFirst({ where: { id: c.id } });
      if (!item) return false;
      const stillEligible =
        (item.status === ReputationStatus.new || item.status === ReputationStatus.classified) &&
        !item.requiresApproval;
      if (!stillEligible) return false;

      const already = await db.moderationDecision.findFirst({
        where: { reputationItemId: item.id, status: { in: [DecisionStatus.proposed, DecisionStatus.approved] } },
        select: { id: true },
      });
      if (already) return false;

      await db.moderationDecision.create({
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

      await db.reputationItem.update({
        where: { id: item.id },
        data: { status: ReputationStatus.needs_approval, requiresApproval: true },
      });

      await db.auditLog.create({
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
      return true;
    });

    if (res.ok && res.value) created++;
    else if (!res.ok) log.error("worker.proposals.item_failed", { reason: res.reason, correlationId: res.correlationId });
  }

  if (created > 0) {
    log.info("worker.proposals.created", { created, autoExecution: AUTO_EXECUTION_ENABLED });
  }
  return created;
}
