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

export interface HideExecutionResult {
  id: string;
  status: HideExecutionStatus;
  reason: string;
  /** True when this result reuses a prior execution instead of creating a new row. */
  idempotent?: boolean;
  /** createdAt of the reused row (for "last dry-run at …" in the UI). */
  createdAt?: Date;
}

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

export type PrimaryAction = "live_hide" | "prepare_dryrun" | "approve" | "hard_stop";

/**
 * V1.26B — decide the PRIMARY action for a queue item's detail. When the item is
 * "live_possible", the live hide (not Approve) is primary; Approve is demoted to a
 * secondary "approve without hiding". Pure + exported so the UI and tests agree.
 */
export function resolvePrimaryAction(input: {
  proposedAction: string;
  expected?: PredictedOutcome | null;
  hasPreflight: boolean;
  alreadyExecuted: boolean;
}): { primary: PrimaryAction; approveIsPrimary: boolean; showLiveForm: boolean } {
  const { proposedAction, expected, hasPreflight, alreadyExecuted } = input;
  const isHide = proposedAction === "hide_comment";
  if (isHide && alreadyExecuted) return { primary: "hard_stop", approveIsPrimary: false, showLiveForm: false };
  const liveMode = isHide && !alreadyExecuted && expected === "live_possible";
  if (liveMode) {
    return hasPreflight
      ? { primary: "live_hide", approveIsPrimary: false, showLiveForm: true }
      : { primary: "prepare_dryrun", approveIsPrimary: false, showLiveForm: false };
  }
  return { primary: "approve", approveIsPrimary: true, showLiveForm: false };
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
  // Threats are only hide-eligible at high or critical risk.
  if (ctx.matchedCategory === "threat" && ctx.riskLevel !== "critical" && ctx.riskLevel !== "high") return { blockedReason: "threat_requires_critical" };
  if (!ctx.externalCommentId) return { blockedReason: "missing_comment_id" };
  return { blockedReason: null };
}

/**
 * Preflight for a controlled LIVE hide (V1.26): a prior dry-run for the SAME
 * queue item / policy / action must exist before a live attempt is allowed.
 */
export async function findPreflightDryRun(ctx: Pick<HideContext, "tenantId" | "queueItemId" | "policyId">) {
  if (!ctx.queueItemId) return null;
  return prisma.platformActionExecution.findFirst({
    where: {
      tenantId: ctx.tenantId, queueItemId: ctx.queueItemId, policyId: ctx.policyId ?? null,
      actionType: "hide_comment", trigger: "approval", status: "dry_run", executedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, reason: true, createdAt: true, executedAt: true },
  });
}

/**
 * Idempotency key for one logical action: a queue item + its action + trigger,
 * scoped to the same item/account/policy. Repeated Approve clicks share this key.
 */
function attemptWhere(ctx: HideContext) {
  return {
    tenantId: ctx.tenantId,
    itemId: ctx.itemId,
    queueItemId: ctx.queueItemId ?? null,
    connectedAccountId: ctx.connectedAccountId,
    actionType: "hide_comment",
    trigger: ctx.trigger,
    policyId: ctx.policyId ?? null,
  };
}

/** Latest existing executions for this action key (newest first). */
async function findExistingExecutions(ctx: HideContext) {
  return prisma.platformActionExecution.findMany({
    where: attemptWhere(ctx),
    orderBy: { createdAt: "desc" },
  });
}

async function record(ctx: HideContext, status: HideExecutionStatus, reason: string, provider?: HideCommentResult): Promise<HideExecutionResult> {
  let exec;
  try {
    exec = await prisma.platformActionExecution.create({
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
  } catch (e) {
    // Race safety net: the partial unique index (queueItemId, actionType, trigger)
    // over `executed` rows rejects a concurrent duplicate live execution. Fall back
    // to the row that won the race instead of creating a second executed row.
    if ((e as { code?: string }).code === "P2002" && status === "executed") {
      const existing = await prisma.platformActionExecution.findFirst({ where: { ...attemptWhere(ctx), status: "executed" }, orderBy: { createdAt: "desc" } });
      if (existing) return { id: existing.id, status: "executed", reason: existing.reason ?? reason, idempotent: true, createdAt: existing.createdAt };
    }
    throw e;
  }
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
  opts?: { transport?: FacebookHideTransport; config?: ReturnType<typeof getLiveActionsConfig>; retry?: boolean; liveAttempt?: boolean },
): Promise<HideExecutionResult> {
  const cfg = opts?.config ?? getLiveActionsConfig();
  const transportOverride = opts?.transport;
  const liveAttempt = opts?.liveAttempt === true;

  // --- Idempotency (V1.25B/V1.26): never create duplicate executions. ---
  const existing = await findExistingExecutions(ctx);
  if (existing.length > 0) {
    const executed = existing.find((r) => r.status === "executed");
    if (executed) {
      // HARD STOP: a live hide already ran for this action — never execute again
      // (covers a double-click on the live button after a successful execution).
      return { id: executed.id, status: "executed", reason: "already_executed", idempotent: true, createdAt: executed.createdAt };
    }
    // A prior dry-run short-circuits the NON-live path (Approve/autonomous). An
    // explicit live attempt intentionally bypasses it — the dry-run was the preflight.
    if (!liveAttempt) {
      const dry = existing.find((r) => r.status === "dry_run");
      if (dry) {
        return { id: dry.id, status: "dry_run", reason: dry.reason ?? "dry_run_mode", idempotent: true, createdAt: dry.createdAt };
      }
    }
    const latest = existing[0]!;
    if (latest.status === "failed" && !opts?.retry) {
      // A failed attempt only retries via an explicit Retry — never a repeated Approve/live click.
      return { id: latest.id, status: "failed", reason: latest.reason ?? "provider_error", idempotent: true, createdAt: latest.createdAt };
    }
    if (latest.status === "blocked") {
      // A blocked attempt re-runs only if env gates / permissions actually changed.
      const { blockedReason: nowReason } = gate(ctx, cfg);
      if (nowReason && nowReason === latest.reason) {
        return { id: latest.id, status: "blocked", reason: nowReason, idempotent: true, createdAt: latest.createdAt };
      }
      // else: gates changed (unblocked or a different reason) → fall through to a fresh attempt.
    }
  }

  const { blockedReason } = gate(ctx, cfg);
  if (blockedReason) {
    return record(ctx, "blocked", blockedReason);
  }

  // --- Explicit LIVE attempt (V1.26 dedicated live-hide button) ---
  if (liveAttempt) {
    // Fail-closed: a live attempt never silently degrades to a dry-run row.
    if (cfg.dryRun) return record(ctx, "blocked", "dry_run_still_enabled");
    if (!cfg.canExecuteLive) return record(ctx, "blocked", "live_not_enabled");
    if (!cfg.liveConfirmed) return record(ctx, "blocked", "live_confirm_required");
    const transport = transportOverride ?? new GraphFacebookHideTransport();
    const r = await hideComment(
      { pageId: ctx.account.pageId ?? ctx.account.externalId, commentId: ctx.externalCommentId!, connectedAccountId: ctx.connectedAccountId, itemId: ctx.itemId, pageAccessToken: ctx.account.accessToken ?? "" },
      { dryRun: false, transport },
    );
    if (r.status === "executed") return record(ctx, "executed", "live_hide_executed", r);
    return record(ctx, "failed", r.providerErrorCode ?? "provider_error", r);
  }

  // --- NON-live path (plain Approve / autonomous). Dry-run unless env permits live. ---
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

  // A MANUAL approval never goes live through this path (V1.26): a real hide must
  // use the dedicated, explicitly-confirmed live button (liveAttempt). So a plain
  // Approve caps at a dry-run even in a fully live env. Only an autonomous policy
  // (trigger=autonomous) may execute here.
  if (ctx.trigger !== "autonomous") {
    const r = await hideComment(
      { pageId: ctx.account.pageId ?? ctx.account.externalId, commentId: ctx.externalCommentId!, connectedAccountId: ctx.connectedAccountId, itemId: ctx.itemId, pageAccessToken: "" },
      { dryRun: true, transport: transportOverride ?? new GraphFacebookHideTransport() },
    );
    return record(ctx, "dry_run", "dry_run_mode", r);
  }

  // Autonomous live path — real transport (mock only via explicit override in a test).
  const transport = transportOverride ?? new GraphFacebookHideTransport();
  const r = await hideComment(
    { pageId: ctx.account.pageId ?? ctx.account.externalId, commentId: ctx.externalCommentId!, connectedAccountId: ctx.connectedAccountId, itemId: ctx.itemId, pageAccessToken: ctx.account.accessToken ?? "" },
    { dryRun: false, transport },
  );
  if (r.status === "executed") return record(ctx, "executed", "live_hide_executed", r);
  return record(ctx, "failed", r.providerErrorCode ?? "provider_error", r);
}
