import "server-only";
import {
  ActorKind,
  ConnectorMode,
  DecisionStatus,
  ModerationAction,
  Permission,
  Platform,
  ReputationStatus,
  RiskLevel,
  assertCan,
  canApproveDecision,
  isPlatformAction,
  TERMINAL_DECISION_STATUSES,
} from "@guardora/core";
import { createConnectorRuntime, type ActionResult } from "@guardora/connectors";
import { withTenantDb, type TenantTx } from "@guardora/db";
import { writeAudit } from "./audit";
import type { AppSession } from "./auth";

export interface ActionOutcome {
  ok: boolean;
  /** True when the platform API cannot perform the action. */
  unsupported?: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/**
 * Create a moderation PROPOSAL. Nothing is executed — the item is routed to the
 * approval queue. Platform actions (reply/hide/delete) will be capability-checked
 * only at execution time.
 */
export async function createProposal(
  session: AppSession,
  itemId: string,
  action: ModerationAction,
  opts: { replyText?: string } = {},
): Promise<ActionOutcome> {
  assertCan(session.role, Permission.ProposalPropose);

  if (action === ModerationAction.Reply && !opts.replyText?.trim()) {
    return { ok: false, message: "Reply text is required." };
  }

  return withTenantDb(session.tenantId, async (db) => {
    const item = await db.reputationItem.findFirst({
      where: { id: itemId, tenantId: session.tenantId },
    });
    if (!item) return { ok: false, message: "Item not found" };

    const decision = await db.moderationDecision.create({
      data: {
        tenantId: session.tenantId,
        brandId: item.brandId,
        reputationItemId: item.id,
        action,
        status: DecisionStatus.Proposed,
        proposedByKind: ActorKind.Human,
        proposedByUserId: session.userId,
        replyText: opts.replyText?.trim() || null,
        confidence: item.riskConfidence,
        riskSnapshot: {
          level: item.riskLevel,
          confidence: item.riskConfidence,
          categories: item.riskCategories,
          sentiment: item.sentiment,
        },
        reason: `Proposed via dashboard by ${session.userName}`,
      },
    });

    // Surface as "needs approval" in the inbox.
    await db.reputationItem.update({
      where: { id: item.id },
      data: { status: ReputationStatus.NeedsApproval, requiresApproval: true },
    });

    await writeAudit({
      session, db,
      event: "proposal.created",
      brandId: item.brandId,
      targetType: "moderation_decision",
      targetId: decision.id,
      metadata: { action, reputationItemId: item.id, platform: item.platform },
    });

    return { ok: true, message: `Proposal created (${action}) — awaiting approval.` };
  });
}

/** Approve a proposal. Subject to the fine-grained approval policy. */
export async function approveProposal(
  session: AppSession,
  proposalId: string,
): Promise<ActionOutcome> {
  assertCan(session.role, Permission.ProposalApprove);

  return withTenantDb(session.tenantId, async (db) => {
    const decision = await db.moderationDecision.findFirst({
      where: { id: proposalId, tenantId: session.tenantId },
    });
    if (!decision) return { ok: false, message: "Proposal not found" };
    if (decision.status !== DecisionStatus.Proposed) {
      return { ok: false, message: `Cannot approve a ${decision.status} proposal.` };
    }

    const riskLevel = (decision.riskSnapshot as { level?: RiskLevel } | null)?.level
      ?? RiskLevel.None;
    if (!canApproveDecision(session.role, decision.action as ModerationAction, riskLevel)) {
      return {
        ok: false,
        message: `Your role (${session.role}) cannot approve this proposal.`,
      };
    }

    await db.moderationDecision.update({
      where: { id: decision.id },
      data: {
        status: DecisionStatus.Approved,
        reviewerUserId: session.userId,
        reviewedAt: new Date(),
      },
    });

    await writeAudit({
      session, db,
      event: "proposal.approved",
      brandId: decision.brandId,
      targetType: "moderation_decision",
      targetId: decision.id,
      metadata: { action: decision.action },
    });

    return { ok: true, message: "Proposal approved. It can now be executed." };
  });
}

/** Reject a proposal (safe — never executes). */
export async function rejectProposal(
  session: AppSession,
  proposalId: string,
): Promise<ActionOutcome> {
  assertCan(session.role, Permission.ProposalApprove);

  return withTenantDb(session.tenantId, async (db) => {
    const decision = await db.moderationDecision.findFirst({
      where: { id: proposalId, tenantId: session.tenantId },
    });
    if (!decision) return { ok: false, message: "Proposal not found" };
    if (decision.status !== DecisionStatus.Proposed) {
      return { ok: false, message: `Cannot reject a ${decision.status} proposal.` };
    }

    await db.moderationDecision.update({
      where: { id: decision.id },
      data: {
        status: DecisionStatus.Rejected,
        reviewerUserId: session.userId,
        reviewedAt: new Date(),
      },
    });

    // Return the item to triage if it has no other open proposals.
    await maybeReturnItemToTriage(db, session.tenantId, decision.reputationItemId);

    await writeAudit({
      session, db,
      event: "proposal.rejected",
      brandId: decision.brandId,
      targetType: "moderation_decision",
      targetId: decision.id,
      metadata: { action: decision.action },
    });

    return { ok: true, message: "Proposal rejected." };
  });
}

/** Cancel/withdraw a proposal before execution. */
export async function cancelProposal(
  session: AppSession,
  proposalId: string,
): Promise<ActionOutcome> {
  assertCan(session.role, Permission.ProposalPropose);

  return withTenantDb(session.tenantId, async (db) => {
    const decision = await db.moderationDecision.findFirst({
      where: { id: proposalId, tenantId: session.tenantId },
    });
    if (!decision) return { ok: false, message: "Proposal not found" };
    if (TERMINAL_DECISION_STATUSES.has(decision.status as DecisionStatus)) {
      return { ok: false, message: `Cannot cancel a ${decision.status} proposal.` };
    }

    await db.moderationDecision.update({
      where: { id: decision.id },
      data: {
        status: DecisionStatus.Cancelled,
        reviewerUserId: session.userId,
        reviewedAt: new Date(),
      },
    });

    await maybeReturnItemToTriage(db, session.tenantId, decision.reputationItemId);

    await writeAudit({
      session, db,
      event: "proposal.cancelled",
      brandId: decision.brandId,
      targetType: "moderation_decision",
      targetId: decision.id,
      metadata: { action: decision.action },
    });

    return { ok: true, message: "Proposal cancelled." };
  });
}

/**
 * Execute an APPROVED proposal. Platform actions are routed through the
 * connector capability check first — an unsupported action FAILS honestly (no
 * fake success). In V1.1 connectors are mock, so a supported action is recorded
 * as executed without any real API call.
 */
export async function executeProposal(
  session: AppSession,
  proposalId: string,
): Promise<ActionOutcome> {
  assertCan(session.role, Permission.ProposalExecute);

  // Phase 1 — tenant READ (short tx). RLS confirms ownership; foreign id → not_found.
  const decision = await withTenantDb(session.tenantId, (db) => db.moderationDecision.findFirst({
    where: { id: proposalId, tenantId: session.tenantId },
    include: {
      reputationItem: {
        include: {
          contentItem: {
            include: { connectedAccount: { select: { mode: true } } },
          },
        },
      },
    },
  }));
  if (!decision) return { ok: false, message: "Proposal not found" };
  if (decision.status !== DecisionStatus.Approved) {
    return { ok: false, message: `Only approved proposals can be executed (this is ${decision.status}).` };
  }

  const item = decision.reputationItem;
  const platform = item.platform as Platform;
  const action = decision.action as ModerationAction;
  const mode = (item.contentItem.connectedAccount?.mode as unknown as ConnectorMode)
    ?? ConnectorMode.Placeholder;

  // Phase 2 — provider HTTP (NO open transaction). Capability + runtime check is
  // mandatory before any platform execution; the runtime hard-disables actions in
  // every V1.2 mode, so this ALWAYS fails for platform actions (never a real
  // hide/reply/delete, never a fake success).
  if (isPlatformAction(action)) {
    const runtime = createConnectorRuntime(platform, mode);
    const ref = { externalContentId: item.contentItem.externalId };
    let result: ActionResult;
    if (action === ModerationAction.Reply) {
      result = await runtime.reply({
        externalContentId: ref.externalContentId,
        text: decision.replyText ?? "",
      });
    } else if (action === ModerationAction.Hide) {
      result = await runtime.hide(ref);
    } else {
      result = await runtime.delete(ref);
    }

    if (!result.ok) {
      const failureReason =
        result.error ??
        (result.unsupported
          ? `${action} is not supported by the ${platform} API.`
          : `${action} could not be executed.`);
      // Phase 3a — tenant WRITE (short tx): record the honest failure.
      await withTenantDb(session.tenantId, async (db) => {
        await db.moderationDecision.update({
          where: { id: decision.id },
          data: { status: DecisionStatus.Failed, failureReason },
        });
        await writeAudit({
          session, db,
          event: "proposal.failed",
          brandId: decision.brandId,
          targetType: "moderation_decision",
          targetId: decision.id,
          metadata: {
            action, platform, mode,
            unsupported: Boolean(result.unsupported),
            disabled: Boolean(result.disabled),
          },
        });
      });
      return { ok: false, unsupported: result.unsupported, message: failureReason };
    }
  }

  // Phase 3b — tenant WRITE (short tx): success (mock for platform actions; state-only otherwise).
  await withTenantDb(session.tenantId, async (db) => {
    await db.moderationDecision.update({
      where: { id: decision.id },
      data: { status: DecisionStatus.Executed, executedAt: new Date() },
    });
    await db.reputationItem.update({
      where: { id: item.id },
      data: { status: itemStatusAfter(action) },
    });
    await writeAudit({
      session, db,
      event: "proposal.executed",
      brandId: decision.brandId,
      targetType: "moderation_decision",
      targetId: decision.id,
      metadata: { action, platform, mock: isPlatformAction(action) },
    });
  });

  return {
    ok: true,
    message: isPlatformAction(action)
      ? `${action} executed (mock — no real platform call).`
      : `${action} executed.`,
  };
}

// ---------------------------------------------------------------------------
// Immediate (non-proposal) actions — Guardora-side, still audited
// ---------------------------------------------------------------------------

/** Immediate status transitions that don't touch a platform. */
export async function applyImmediate(
  session: AppSession,
  itemId: string,
  target: ReputationStatus.Resolved | ReputationStatus.Escalated | ReputationStatus.Ignored,
): Promise<ActionOutcome> {
  assertCan(session.role, Permission.InboxAct);

  return withTenantDb(session.tenantId, async (db) => {
    const item = await db.reputationItem.findFirst({
      where: { id: itemId, tenantId: session.tenantId },
    });
    if (!item) return { ok: false, message: "Item not found" };

    const action =
      target === ReputationStatus.Resolved
        ? ModerationAction.MarkResolved
        : target === ReputationStatus.Escalated
          ? ModerationAction.Escalate
          : ModerationAction.Ignore;

    await db.reputationItem.update({
      where: { id: item.id },
      data: { status: target },
    });

    await db.moderationDecision.create({
      data: {
        tenantId: session.tenantId,
        brandId: item.brandId,
        reputationItemId: item.id,
        action,
        status: DecisionStatus.Executed,
        proposedByKind: ActorKind.Human,
        proposedByUserId: session.userId,
        reviewerUserId: session.userId,
        reviewedAt: new Date(),
        executedAt: new Date(),
        reason: `Immediate ${action} via dashboard`,
      },
    });

    await writeAudit({
      session, db,
      event: `inbox.${target}`,
      brandId: item.brandId,
      targetType: "reputation_item",
      targetId: item.id,
      metadata: { action, immediate: true },
    });

    return { ok: true, message: `Item marked ${target}.` };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemStatusAfter(action: ModerationAction): ReputationStatus {
  switch (action) {
    case ModerationAction.MarkResolved:
      return ReputationStatus.Resolved;
    case ModerationAction.Ignore:
      return ReputationStatus.Ignored;
    case ModerationAction.Escalate:
      return ReputationStatus.Escalated;
    default:
      return ReputationStatus.Actioned;
  }
}

/** If an item has no remaining open proposals, return it to triage. Runs in the caller's tenant tx. */
async function maybeReturnItemToTriage(
  db: TenantTx,
  tenantId: string,
  reputationItemId: string,
): Promise<void> {
  const open = await db.moderationDecision.count({
    where: {
      tenantId,
      reputationItemId,
      status: { in: [DecisionStatus.Proposed, DecisionStatus.Approved] },
    },
  });
  if (open === 0) {
    await db.reputationItem.update({
      where: { id: reputationItemId },
      data: { status: ReputationStatus.Classified, requiresApproval: false },
    });
  }
}
