import { prisma, ActorKind } from "@guardora/db";
import { getLiveActionsConfig } from "@guardora/config";
import {
  hideComment,
  GraphFacebookHideTransport,
  type FacebookHideTransport,
  type HideCommentResult,
} from "@guardora/connectors";
import { LIVE_ELIGIBLE_CATEGORIES, FACEBOOK_HIDE_PERMISSION } from "@guardora/ai";

/**
 * Controlled Facebook comment hide. Fail-closed: every gate must pass, and even
 * then dry-run is the default. Reply/delete are never touched; Instagram is out
 * of scope. No tokens/secrets are ever logged or stored.
 */

export type HideExecutionStatus = "blocked" | "dry_run" | "executed" | "failed";

export interface HideContext {
  tenantId: string;
  brandId: string;
  itemId: string;
  connectedAccountId: string;
  platform: string;
  externalCommentId: string | null;
  externalPostId?: string | null;
  decision: string;
  matchedCategory: string;
  confidence: number;
  riskLevel: string;
  /** The Auto-Protect policy mode for the matched category. */
  policyMode: string;
  account: {
    status: string;
    health: string;
    grantedPermissions: string[];
    accessToken?: string | null;
    pageId?: string | null;
    externalId: string;
  };
  requestedBy?: "system" | "user";
  trigger?: "auto_protect" | "manual_approval";
}

/** Live policy modes (a category opted into controlled live hide). */
const LIVE_POLICY_MODES = new Set(["auto_hide_live", "auto_hide_live_reserved"]);
const MIN_CONFIDENCE = 0.8;

/** Determine why a live hide is (not) allowed. Fail-closed, ordered gates. */
function gate(ctx: HideContext, cfg: ReturnType<typeof getLiveActionsConfig>): { blockedReason: string | null } {
  if (!cfg.liveEnabled) return { blockedReason: "global_disabled" };
  if (!cfg.facebookHideEnabled) return { blockedReason: "facebook_hide_disabled" };
  if (ctx.platform !== "facebook_page") return { blockedReason: "unsupported_platform" };
  if (ctx.account.status === "mock_connected") return { blockedReason: "account_is_demo" };
  if (ctx.account.status !== "active") return { blockedReason: "account_not_active" };
  if (ctx.account.health !== "healthy") return { blockedReason: "unhealthy_account" };
  if (!ctx.account.grantedPermissions.includes(FACEBOOK_HIDE_PERMISSION)) return { blockedReason: "missing_permission" };
  if (ctx.decision !== "would_auto_hide") return { blockedReason: "not_would_auto_hide" };
  if (ctx.matchedCategory === "normal_criticism") return { blockedReason: "safety_normal_criticism" };
  if (!LIVE_ELIGIBLE_CATEGORIES.has(ctx.matchedCategory as never)) return { blockedReason: "category_not_live_eligible" };
  if (!LIVE_POLICY_MODES.has(ctx.policyMode)) return { blockedReason: "policy_not_live" };
  if (ctx.confidence < MIN_CONFIDENCE) return { blockedReason: "low_confidence" };
  if (ctx.matchedCategory === "threat" && ctx.riskLevel !== "critical") return { blockedReason: "threat_requires_critical" };
  if (!ctx.externalCommentId) return { blockedReason: "missing_comment_id" };
  return { blockedReason: null };
}

async function record(ctx: HideContext, status: HideExecutionStatus, reason: string, provider?: HideCommentResult): Promise<{ id: string; status: HideExecutionStatus; reason: string }> {
  const exec = await prisma.platformActionExecution.create({
    data: {
      tenantId: ctx.tenantId, brandId: ctx.brandId, itemId: ctx.itemId,
      connectedAccountId: ctx.connectedAccountId, platform: ctx.platform, actionType: "hide_comment",
      requestedBy: ctx.requestedBy ?? "system", trigger: ctx.trigger ?? "auto_protect",
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
      metadata: { actionType: "hide_comment", status, reason, category: ctx.matchedCategory, executed: status === "executed" } as never,
    },
  });
  return { id: exec.id, status, reason };
}

/**
 * Attempt a controlled Facebook comment hide. Only ever called for a
 * `would_auto_hide` decision whose category is in live policy mode. Returns the
 * recorded execution. Never throws on a provider error — records `failed`.
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

  // Live path — real transport (mock only via explicit override in a manual test).
  const transport = transportOverride ?? new GraphFacebookHideTransport();
  const r = await hideComment(
    { pageId: ctx.account.pageId ?? ctx.account.externalId, commentId: ctx.externalCommentId!, connectedAccountId: ctx.connectedAccountId, itemId: ctx.itemId, pageAccessToken: ctx.account.accessToken ?? "" },
    { dryRun: false, transport },
  );
  if (r.status === "executed") return record(ctx, "executed", "live_hide_executed", r);
  return record(ctx, "failed", r.providerErrorCode ?? "provider_error", r);
}
