import { prisma, ActorKind } from "@guardora/db";
import { getLiveActionsConfig } from "@guardora/config";
import {
  hideComment,
  GraphFacebookHideTransport,
  type FacebookHideTransport,
  type HideCommentResult,
} from "@guardora/connectors";
import { AUTONOMOUS_ELIGIBLE, NEVER_AUTONOMOUS, FACEBOOK_HIDE_PERMISSION } from "@guardora/ai";

/**
 * Controlled Facebook comment hide, driven ONLY by ControlPolicy. Fail-closed:
 * every gate must pass, and even then dry-run is the default. Reply/delete are
 * never touched; Instagram is out of scope. No tokens/secrets are ever logged or
 * stored. Autonomous never applies to normal criticism or customer-voice
 * categories (hard safety floor).
 */

export type HideExecutionStatus = "blocked" | "dry_run" | "executed" | "failed";

export interface HideContext {
  tenantId: string;
  brandId: string;
  itemId: string;
  queueItemId?: string | null;
  policyId?: string | null;
  connectedAccountId: string;
  platform: string;
  externalCommentId: string | null;
  externalPostId?: string | null;
  matchedCategory: string;
  confidence: number;
  riskLevel: string;
  /** ControlPolicy mode: monitor | assist | approval | autonomous. */
  mode: string;
  /** approval = a human approved this queue item; autonomous = policy-driven. */
  trigger: "approval" | "autonomous";
  account: {
    status: string;
    health: string;
    grantedPermissions: string[];
    accessToken?: string | null;
    pageId?: string | null;
    externalId: string;
  };
  requestedBy?: "system" | "user";
}

const MIN_CONFIDENCE = 0.8;

export type PredictedOutcome = "blocked" | "dry_run" | "live_possible";

/**
 * Predict what a hide attempt WOULD do — WITHOUT executing or touching the DB.
 * Used by the controlled-test panel to show the expected result before any action.
 */
export function predictHideOutcome(
  ctx: HideContext,
  cfg: ReturnType<typeof getLiveActionsConfig>,
): { expected: PredictedOutcome; reason: string } {
  const { blockedReason } = gate(ctx, cfg);
  if (blockedReason) return { expected: "blocked", reason: blockedReason };
  if (cfg.dryRun || !cfg.canExecuteLive) return { expected: "dry_run", reason: "dry_run_mode" };
  if (!cfg.liveConfirmed) return { expected: "blocked", reason: "live_confirm_required" };
  return { expected: "live_possible", reason: "all_gates_passed_and_confirmed" };
}

/** Determine why a live hide is (not) allowed. Fail-closed, ordered gates. */
function gate(ctx: HideContext, cfg: ReturnType<typeof getLiveActionsConfig>): { blockedReason: string | null } {
  if (!cfg.liveEnabled) return { blockedReason: "global_disabled" };
  if (!cfg.facebookHideEnabled) return { blockedReason: "facebook_hide_disabled" };
  if (ctx.platform !== "facebook_page") return { blockedReason: "unsupported_platform" };
  if (ctx.account.status === "mock_connected") return { blockedReason: "account_is_demo" };
  if (ctx.account.status !== "active") return { blockedReason: "account_not_active" };
  if (ctx.account.health !== "healthy") return { blockedReason: "unhealthy_account" };
  if (!ctx.account.grantedPermissions.includes(FACEBOOK_HIDE_PERMISSION)) return { blockedReason: "missing_permission" };
  // Hard safety floor: customer-voice categories are never auto-hidden.
  if (NEVER_AUTONOMOUS.has(ctx.matchedCategory as never)) return { blockedReason: "safety_never_autonomous" };
  if (!AUTONOMOUS_ELIGIBLE.has(ctx.matchedCategory as never)) return { blockedReason: "category_not_eligible" };
  // Autonomous execution requires the ControlPolicy to be in autonomous mode.
  if (ctx.trigger === "autonomous" && ctx.mode !== "autonomous") return { blockedReason: "policy_not_autonomous" };
  if (ctx.confidence < MIN_CONFIDENCE) return { blockedReason: "low_confidence" };
  if (ctx.matchedCategory === "threat" && ctx.riskLevel !== "critical") return { blockedReason: "threat_requires_critical" };
  if (!ctx.externalCommentId) return { blockedReason: "missing_comment_id" };
  return { blockedReason: null };
}

async function record(ctx: HideContext, status: HideExecutionStatus, reason: string, provider?: HideCommentResult): Promise<{ id: string; status: HideExecutionStatus; reason: string }> {
  const exec = await prisma.platformActionExecution.create({
    data: {
      tenantId: ctx.tenantId, brandId: ctx.brandId, itemId: ctx.itemId,
      queueItemId: ctx.queueItemId ?? null, policyId: ctx.policyId ?? null,
      connectedAccountId: ctx.connectedAccountId, platform: ctx.platform, actionType: "hide_comment",
      requestedBy: ctx.requestedBy ?? "system", trigger: ctx.trigger,
      status, reason, policyCategory: ctx.matchedCategory, confidence: ctx.confidence,
      externalCommentId: ctx.externalCommentId, externalPostId: ctx.externalPostId ?? null,
      providerResponseCode: provider?.providerResponseCode ?? null,
      providerErrorCode: provider?.providerErrorCode ?? null,
      providerErrorMessage: provider?.providerErrorMessage ?? null,
      executedAt: status === "executed" ? new Date() : null,
    },
  });
  const event = status === "executed" ? "platform_action.executed"
    : status === "failed" ? "platform_action.failed"
    : status === "dry_run" ? "platform_action.dry_run"
    : "platform_action.blocked";
  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId, brandId: ctx.brandId, event, actorKind: ActorKind.system,
      targetType: "platform_action_execution", targetId: exec.id,
      // No tokens/secrets. Only classified fields.
      metadata: { actionType: "hide_comment", status, reason, category: ctx.matchedCategory, trigger: ctx.trigger, executed: status === "executed" } as never,
    },
  });
  return { id: exec.id, status, reason };
}

/**
 * Attempt a controlled Facebook comment hide within a ControlPolicy. Returns the
 * recorded PlatformActionExecution. Never throws on a provider error — records
 * `failed`. Never a live action unless every env gate + safety gate passes.
 */
export async function attemptFacebookHide(
  ctx: HideContext,
  opts?: { transport?: FacebookHideTransport; config?: ReturnType<typeof getLiveActionsConfig> },
): Promise<{ id: string; status: HideExecutionStatus; reason: string }> {
  const cfg = opts?.config ?? getLiveActionsConfig();
  const transportOverride = opts?.transport;
  const { blockedReason } = gate(ctx, cfg);
  if (blockedReason) {
    return record(ctx, "blocked", blockedReason);
  }

  // All gates passed. Dry-run unless env explicitly permits real execution.
  if (cfg.dryRun || !cfg.canExecuteLive) {
    const r = await hideComment(
      { pageId: ctx.account.pageId ?? ctx.account.externalId, commentId: ctx.externalCommentId!, connectedAccountId: ctx.connectedAccountId, itemId: ctx.itemId, pageAccessToken: "" },
      { dryRun: true, transport: transportOverride ?? new GraphFacebookHideTransport() },
    );
    return record(ctx, "dry_run", "dry_run_mode", r);
  }

  // SECOND LOCK: even with all env gates on and dry-run off, a real Graph hide
  // requires an explicit LIVE_HIDE_TEST_CONFIRM=YES. Prevents an accidental live test.
  if (!cfg.liveConfirmed) {
    return record(ctx, "blocked", "live_confirm_required");
  }

  // Live path — real transport (mock only via explicit override in a manual test).
  const transport = transportOverride ?? new GraphFacebookHideTransport();
  const r = await hideComment(
    { pageId: ctx.account.pageId ?? ctx.account.externalId, commentId: ctx.externalCommentId!, connectedAccountId: ctx.connectedAccountId, itemId: ctx.itemId, pageAccessToken: ctx.account.accessToken ?? "" },
    { dryRun: false, transport },
  );
  if (r.status === "executed") return record(ctx, "executed", "live_hide_executed", r);
  return record(ctx, "failed", r.providerErrorCode ?? "provider_error", r);
}
