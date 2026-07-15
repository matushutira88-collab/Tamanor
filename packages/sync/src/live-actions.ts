import { withTenantDb, ActorKind, decryptToken } from "@guardora/db";
import { getLiveActionsConfig } from "@guardora/config";
import {
  hideComment,
  unhideComment,
  GraphFacebookHideTransport,
  type FacebookHideTransport,
  type HideCommentResult,
} from "@guardora/connectors";
import { AUTONOMOUS_ELIGIBLE, NEVER_AUTONOMOUS, FACEBOOK_HIDE_PERMISSION } from "@guardora/ai";
import { evaluateProductionSafety, type ProductionSafetyContext, type SafetyEvaluation } from "./production-safety";

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
    /** Page token expiry, if known. Past → token_expired preflight block. */
    tokenExpiresAt?: Date | string | null;
    /** Account already flagged as needing reconnect (e.g. prior token_expired). */
    needsReconnect?: boolean;
    /** V1.27C connection manager state. */
    connectionStatus?: string | null;
    tokenHealth?: string | null;
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

export type PrimaryAction = "live_hide" | "approve" | "hard_stop";

/**
 * V1.26C — decide the PRIMARY action for a queue item's detail. When the item is
 * "live_possible", the live hide (not Approve) is the primary action and the live
 * form renders directly — it is NOT conditioned on a preflight or any other UI
 * state (the server still self-preflights + re-checks every gate). Approve is
 * demoted to a secondary "approve without hiding". Pure + exported so UI + tests agree.
 */
export function resolvePrimaryAction(input: {
  proposedAction: string;
  expected?: PredictedOutcome | null;
  alreadyExecuted: boolean;
}): { primary: PrimaryAction; approveIsPrimary: boolean; showLiveForm: boolean } {
  const { proposedAction, expected, alreadyExecuted } = input;
  const isHide = proposedAction === "hide_comment";
  if (isHide && alreadyExecuted) return { primary: "hard_stop", approveIsPrimary: false, showLiveForm: false };
  const liveMode = isHide && !alreadyExecuted && expected === "live_possible";
  if (liveMode) return { primary: "live_hide", approveIsPrimary: false, showLiveForm: true };
  return { primary: "approve", approveIsPrimary: true, showLiveForm: false };
}

/** Determine why a live hide is (not) allowed. Fail-closed, ordered gates. */
function gate(ctx: HideContext, cfg: ReturnType<typeof getLiveActionsConfig>): { blockedReason: string | null } {
  if (!cfg.liveEnabled) return { blockedReason: "global_disabled" };
  if (!cfg.facebookHideEnabled) return { blockedReason: "facebook_hide_disabled" };
  if (ctx.platform !== "facebook_page") return { blockedReason: "unsupported_platform" };
  if (ctx.account.status === "mock_connected") return { blockedReason: "account_is_demo" };
  if (ctx.account.status !== "active") return { blockedReason: "account_not_active" };
  // V1.27C connection preflight — a hide never runs on an unverified/bad token.
  if (ctx.account.connectionStatus && ctx.account.connectionStatus !== "connected") return { blockedReason: "reconnect_required" };
  if (ctx.account.tokenHealth && (ctx.account.tokenHealth === "expired" || ctx.account.tokenHealth === "invalid" || ctx.account.tokenHealth === "revoked")) return { blockedReason: "token_not_healthy" };
  // V1.27B token preflight — before the generic health check so the reason is precise.
  if (ctx.account.needsReconnect) return { blockedReason: "token_expired" };
  if (ctx.account.tokenExpiresAt && new Date(ctx.account.tokenExpiresAt).getTime() <= Date.now()) return { blockedReason: "token_expired" };
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
  return withTenantDb(ctx.tenantId, (db) => db.platformActionExecution.findFirst({
    where: {
      tenantId: ctx.tenantId, queueItemId: ctx.queueItemId, policyId: ctx.policyId ?? null,
      actionType: "hide_comment", trigger: "approval", status: "dry_run", executedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, reason: true, createdAt: true, executedAt: true },
  }));
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
  return withTenantDb(ctx.tenantId, (db) => db.platformActionExecution.findMany({
    where: attemptWhere(ctx),
    orderBy: { createdAt: "desc" },
  }));
}

async function record(ctx: HideContext, status: HideExecutionStatus, reason: string, provider?: HideCommentResult): Promise<HideExecutionResult> {
  // Each DB step is its own short tenant transaction (RLS via appDb). record() has
  // no provider HTTP, so multiple short txs are safe and keep tenant isolation.
  let exec;
  try {
    exec = await withTenantDb(ctx.tenantId, (db) => db.platformActionExecution.create({
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
    }));
  } catch (e) {
    // Race safety net: the partial unique index (queueItemId, actionType, trigger)
    // over `executed` rows rejects a concurrent duplicate live execution. Fall back
    // to the row that won the race instead of creating a second executed row.
    if ((e as { code?: string }).code === "P2002" && status === "executed") {
      const existing = await withTenantDb(ctx.tenantId, (db) => db.platformActionExecution.findFirst({ where: { ...attemptWhere(ctx), status: "executed" }, orderBy: { createdAt: "desc" } }));
      if (existing) return { id: existing.id, status: "executed", reason: existing.reason ?? reason, idempotent: true, createdAt: existing.createdAt };
    }
    throw e;
  }
  // V1.27B — a token_expired failure marks the account for reconnect so the next
  // hide preflight blocks precisely and the UI can surface a reconnect CTA.
  if (status === "failed" && provider?.providerErrorCode === "token_expired") {
    await withTenantDb(ctx.tenantId, (db) => db.connectedAccount.updateMany({
      where: { id: ctx.connectedAccountId },
      data: { health: "error", lastError: "token_expired", lastErrorAt: new Date() },
    }));
  }
  // V1.27E — a completed live hide resolves the queue item out of approval_required.
  if (status === "executed") {
    await resolveQueueItem(ctx.tenantId, ctx.queueItemId, "executed");
  }
  const event = status === "executed" ? "platform_action.executed"
    : status === "failed" ? "platform_action.failed"
    : status === "dry_run" ? "platform_action.dry_run"
    : "platform_action.blocked";
  await withTenantDb(ctx.tenantId, (db) => db.auditLog.create({
    data: {
      tenantId: ctx.tenantId, brandId: ctx.brandId, event, actorKind: ActorKind.system,
      targetType: "platform_action_execution", targetId: exec.id,
      // No tokens/secrets. Only classified fields.
      metadata: { actionType: "hide_comment", status, reason, category: ctx.matchedCategory, trigger: ctx.trigger, executed: status === "executed" } as never,
    },
  }));
  return { id: exec.id, status, reason };
}

/**
 * Attempt a controlled Facebook comment hide within a ControlPolicy. Returns the
 * recorded PlatformActionExecution. Never throws on a provider error — records
 * `failed`. Never a live action unless every env gate + safety gate passes.
 */
/** True when the account row claims a token/connection problem worth revalidating. */
function accountLooksStale(a: HideContext["account"]): boolean {
  return (
    (!!a.connectionStatus && a.connectionStatus !== "connected") ||
    (!!a.tokenHealth && (a.tokenHealth === "expired" || a.tokenHealth === "invalid" || a.tokenHealth === "revoked")) ||
    a.needsReconnect === true ||
    (!!a.tokenExpiresAt && new Date(a.tokenExpiresAt).getTime() <= Date.now())
  );
}

/**
 * V1.27D self-heal — when the account row says needs_reconnect/expired, do a FRESH
 * Page-token check (GET /{pageId}). If it SUCCEEDS, repair the row to connected/ok
 * and continue (a real, working token must override a stale false-expired flag).
 * Unknown expiry never counts as expired. If it FAILS, mark precisely and let the
 * gate block. Mutates ctx.account so the subsequent gate sees the repaired state.
 */
async function revalidateAndRepair(ctx: HideContext, transport: FacebookHideTransport): Promise<void> {
  const token = ctx.account.accessToken;
  if (!transport.getPageTokenState || !token) return; // cannot validate → leave state as-is
  const st = await transport.getPageTokenState(ctx.account.pageId ?? ctx.account.externalId, token);
  const now = new Date();
  if (st.ok) {
    await withTenantDb(ctx.tenantId, (db) => db.connectedAccount.updateMany({
      // V1.45B — a self-heal must NEVER restore a user-disconnected account to connected/healthy.
      where: { id: ctx.connectedAccountId, status: { not: "disconnected" as never } },
      data: { connectionStatus: "connected", tokenHealth: "ok", health: "healthy", requiresReconnectReason: null, lastError: null, lastErrorAt: null, lastTokenCheckAt: now, lastTokenCheckResult: "ok", lastSuccessfulGraphCheckAt: now, tokenExpiresAt: null },
    }));
    ctx.account.connectionStatus = "connected";
    ctx.account.tokenHealth = "ok";
    ctx.account.needsReconnect = false;
    ctx.account.tokenExpiresAt = null;
    return;
  }
  // A transient/generic error must NOT downgrade a connection — only a real OAuth failure.
  if (st.errorCode === "rate_limit" || st.errorCode === "network" || st.errorCode === "generic") {
    await withTenantDb(ctx.tenantId, (db) => db.connectedAccount.updateMany({ where: { id: ctx.connectedAccountId }, data: { lastTokenCheckAt: now, lastTokenCheckResult: st.errorCode } }));
    return;
  }
  const tokenHealth = st.errorCode === "token_expired" ? "expired" : st.errorCode === "revoked" ? "revoked" : "invalid";
  await withTenantDb(ctx.tenantId, (db) => db.connectedAccount.updateMany({
    where: { id: ctx.connectedAccountId },
    data: { connectionStatus: "needs_reconnect", tokenHealth, health: "error", requiresReconnectReason: st.errorCode, lastError: st.errorCode, lastErrorAt: now, lastTokenCheckAt: now, lastTokenCheckResult: st.errorCode },
  }));
  ctx.account.connectionStatus = "needs_reconnect";
  ctx.account.tokenHealth = tokenHealth;
}

/**
 * V1.27E — move a handled queue item out of the active approval queue. A successful
 * hide (or an already-hidden / deleted comment) must not linger as approval_required.
 * Never touches a rejected item.
 */
async function resolveQueueItem(tenantId: string, queueItemId: string | null | undefined, state: "executed" | "no_action"): Promise<void> {
  if (!queueItemId) return;
  await withTenantDb(tenantId, (db) => db.actionQueueItem.updateMany({
    where: { id: queueItemId, queueState: { notIn: ["rejected"] } },
    data: { queueState: state },
  }));
}

/** V1.27C — flag an account as needing reconnect after a live token failure. */
async function markAccountReconnect(tenantId: string, connectedAccountId: string, errorCode: string): Promise<void> {
  const tokenHealth = errorCode === "token_expired" ? "expired" : errorCode === "revoked" ? "revoked" : "invalid";
  await withTenantDb(tenantId, (db) => db.connectedAccount.updateMany({
    where: { id: connectedAccountId },
    data: { connectionStatus: "needs_reconnect", tokenHealth, health: "error", lastError: errorCode, lastErrorAt: new Date(), requiresReconnectReason: errorCode },
  }));
}

/**
 * V1.27C — real-time preflight right before a live hide: read the comment's
 * can_hide/is_hidden (which also validates the Page token). Returns a terminal
 * result to short-circuit, or null to proceed with the POST hide.
 */
async function commentPreflight(ctx: HideContext, transport: FacebookHideTransport): Promise<HideExecutionResult | null> {
  if (!transport.getCommentState || !ctx.externalCommentId) return null;
  const st = await transport.getCommentState(ctx.externalCommentId, ctx.account.accessToken ?? "");
  if (!st.ok) {
    // V1.27E — the comment was deleted/unavailable on Facebook. Terminal + neutral:
    // NOT a token error, NOT reconnect. Resolve the queue item.
    if (st.errorCode === "not_found") {
      await resolveQueueItem(ctx.tenantId, ctx.queueItemId, "no_action");
      return record(ctx, "blocked", "comment_deleted_or_unavailable");
    }
    // The token failed the live check → mark for reconnect, never POST.
    if (st.errorCode === "token_expired" || st.errorCode === "token_invalid" || st.errorCode === "revoked") {
      await markAccountReconnect(ctx.tenantId, ctx.connectedAccountId, st.errorCode === "token_invalid" ? "token_invalid" : st.errorCode);
      return record(ctx, "blocked", "reconnect_required");
    }
    if (st.errorCode === "permission") return record(ctx, "blocked", "missing_permission");
    return record(ctx, "failed", st.errorCode);
  }
  if (st.isHidden) return record(ctx, "executed", "already_hidden"); // record() resolves the queue item
  if (!st.canHide) {
    // Terminal: nobody (human or system) can hide this comment → resolve, not approval.
    await resolveQueueItem(ctx.tenantId, ctx.queueItemId, "no_action");
    return record(ctx, "blocked", "facebook_can_hide_false");
  }
  return null;
}

/**
 * V1.28A — verify a hide AFTER a 200 POST when possible. A verify GET that still
 * reports is_hidden=false records verification_failed — never a fake success. A
 * GET that cannot run/errors keeps the 200 as authoritative (verify "if possible").
 */
async function recordVerifiedHide(ctx: HideContext, transport: FacebookHideTransport, provider: HideCommentResult): Promise<HideExecutionResult> {
  if (transport.getCommentState && ctx.externalCommentId) {
    const v = await transport.getCommentState(ctx.externalCommentId, ctx.account.accessToken ?? "");
    if (v.ok && !v.isHidden) {
      return record(ctx, "failed", "verification_failed", provider);
    }
  }
  return record(ctx, "executed", "live_hide_executed", provider);
}

/** Write the safety-decision audit event (never tokens/secrets). */
async function writeSafetyAudit(ctx: HideContext, ev: SafetyEvaluation): Promise<void> {
  await withTenantDb(ctx.tenantId, (db) => db.auditLog.create({
    data: {
      tenantId: ctx.tenantId, brandId: ctx.brandId, event: ev.auditEvent, actorKind: ActorKind.system,
      targetType: "action_queue_item", targetId: ctx.queueItemId ?? ctx.itemId,
      metadata: { actionType: "hide_comment", trigger: ctx.trigger, category: ctx.matchedCategory, outcome: ev.outcome, reason: ev.reason } as never,
    },
  }));
}

export async function attemptFacebookHide(
  ctx: HideContext,
  opts?: { transport?: FacebookHideTransport; config?: ReturnType<typeof getLiveActionsConfig>; retry?: boolean; liveAttempt?: boolean; safety?: ProductionSafetyContext },
): Promise<HideExecutionResult> {
  const cfg = opts?.config ?? getLiveActionsConfig();
  const transportOverride = opts?.transport;
  const liveAttempt = opts?.liveAttempt === true;
  // V1.27D — optional, token-SAFE runtime trace (enable with HIDE_TRACE=1). Never
  // logs a token or secret — only phase names + connection/token health + status.
  const TRACE = process.env.HIDE_TRACE === "1";
  const trace = (phase: string, extra: Record<string, unknown> = {}) => {
    if (TRACE) console.log(`[hide-trace] ${phase}`, { liveAttempt, item: ctx.itemId, ...extra });
  };
  trace("start", { hasToken: !!ctx.account.accessToken, connectionStatus: ctx.account.connectionStatus, tokenHealth: ctx.account.tokenHealth, health: ctx.account.health, tokenExpiresAt: ctx.account.tokenExpiresAt ?? null, needsReconnect: ctx.account.needsReconnect ?? false });

  // NOTE (V1.50E): the billing access-state gate lives at the CALLERS of this primitive (the worker
  // autonomous path in ./index.ts, the manual action-queue action, and executeProposal) rather than
  // here — this keeps `attemptFacebookHide` a pure, DB-injection-free execution primitive.

  // --- Idempotency (V1.25B/V1.26): never create duplicate executions. ---
  const existing = await findExistingExecutions(ctx);
  trace("existing", { count: existing.length, latest: existing[0] ? `${existing[0].status}/${existing[0].reason}` : null });
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
      // V1.27D — a historical blocked row must NEVER permanently lock a future live
      // attempt. Self-heal a stale needs_reconnect/expired account BEFORE re-evaluating
      // the gate, so a now-valid token unblocks. (Without this, gate() would echo the
      // old reconnect_required and revalidateAndRepair below would never run.)
      const stale0 = accountLooksStale(ctx.account);
      trace("blocked-idempotency", { latestReason: latest.reason, accountLooksStale: stale0 });
      if ((cfg.canExecuteLive || liveAttempt) && stale0) {
        await revalidateAndRepair(ctx, transportOverride ?? new GraphFacebookHideTransport());
        trace("blocked-idempotency:after-selfheal", { connectionStatus: ctx.account.connectionStatus, tokenHealth: ctx.account.tokenHealth });
      }
      const { blockedReason: nowReason } = gate(ctx, cfg);
      trace("blocked-idempotency:regate", { nowReason, latestReason: latest.reason });
      if (nowReason && nowReason === latest.reason) {
        return { id: latest.id, status: "blocked", reason: nowReason, idempotent: true, createdAt: latest.createdAt };
      }
      // else: gates changed or self-heal repaired the account → fall through to a fresh attempt.
    }
  }

  // --- V1.27 Production Safe Mode envelope (kill switches, limits, floor). ---
  // Runs for BOTH manual + autonomous when a safety context is supplied. Blocks or
  // downgrades to approval without ever calling the transport.
  if (opts?.safety) {
    const ev = evaluateProductionSafety({ trigger: ctx.trigger, category: ctx.matchedCategory, confidence: ctx.confidence, riskLevel: ctx.riskLevel, safety: opts.safety });
    // Audit the safety decision BEFORE any action (allowed, blocked, or downgraded).
    await writeSafetyAudit(ctx, ev);
    if (ev.outcome !== "allow") {
      return record(ctx, "blocked", ev.reason);
    }
  }

  // V1.27D — before blocking on a stale needs_reconnect/expired row, revalidate the
  // Page token against Graph. A working token repairs the row and proceeds; unknown
  // expiry is never treated as expired. Only runs when a live action is possible.
  if ((cfg.canExecuteLive || liveAttempt) && accountLooksStale(ctx.account)) {
    await revalidateAndRepair(ctx, transportOverride ?? new GraphFacebookHideTransport());
  }

  const { blockedReason } = gate(ctx, cfg);
  trace("gate", { blockedReason, connectionStatus: ctx.account.connectionStatus, tokenHealth: ctx.account.tokenHealth, health: ctx.account.health });
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
    const pre = await commentPreflight(ctx, transport);
    trace("commentPreflight", { result: pre ? `${pre.status}/${pre.reason}` : "proceed" });
    if (pre) return pre;
    trace("hidePOST", { called: true });
    const r = await hideComment(
      { pageId: ctx.account.pageId ?? ctx.account.externalId, commentId: ctx.externalCommentId!, connectedAccountId: ctx.connectedAccountId, itemId: ctx.itemId, pageAccessToken: ctx.account.accessToken ?? "" },
      { dryRun: false, transport },
    );
    trace("hidePOST:result", { status: r.status, providerErrorCode: r.providerErrorCode ?? null, providerResponseCode: r.providerResponseCode ?? null });
    if (r.status === "executed") return recordVerifiedHide(ctx, transport, r);
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

  // SECOND LOCK: a real Graph hide needs either the test confirm (LIVE_HIDE_TEST_
  // CONFIRM=YES) OR a production per-brand live opt-in. The brand opt-in is proven
  // by a passing Production Safe Mode context on an autonomous trigger (the safety
  // gate already required liveModeEnabled + autonomousHideEnabled). Prevents an
  // accidental live hide while enabling real autonomous production operation.
  const productionOptIn = ctx.trigger === "autonomous" && opts?.safety?.flags.productionSafeMode === true;
  if (!cfg.liveConfirmed && !productionOptIn) {
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
  const pre = await commentPreflight(ctx, transport);
  if (pre) return pre;
  const r = await hideComment(
    { pageId: ctx.account.pageId ?? ctx.account.externalId, commentId: ctx.externalCommentId!, connectedAccountId: ctx.connectedAccountId, itemId: ctx.itemId, pageAccessToken: ctx.account.accessToken ?? "" },
    { dryRun: false, transport },
  );
  if (r.status === "executed") return recordVerifiedHide(ctx, transport, r);
  return record(ctx, "failed", r.providerErrorCode ?? "provider_error", r);
}

export type CommentLifecycle = "visible" | "hidden" | "deleted" | "cannot_hide" | "token_error" | "unknown";

/**
 * V1.27E — read a comment's lifecycle state from Facebook (read-only; no hide).
 * `deleted` = removed/unavailable on Facebook (not a token error). Used by the UI
 * to resolve items whose comment no longer exists. Never logs a token.
 */
export async function getCommentLifecycle(
  input: { tenantId: string; accountId: string; commentId: string },
  opts?: { transport?: FacebookHideTransport },
): Promise<{ status: CommentLifecycle }> {
  if (!input.commentId) return { status: "unknown" };
  const acct = await withTenantDb(input.tenantId, (db) => db.connectedAccount.findFirst({ where: { id: input.accountId }, select: { accessToken: true, longLivedToken: true } }));
  const token = decryptToken(acct?.longLivedToken ?? acct?.accessToken);
  const transport = opts?.transport ?? new GraphFacebookHideTransport();
  if (!token || !transport.getCommentState) return { status: "unknown" };
  const st = await transport.getCommentState(input.commentId, token);
  if (!st.ok) {
    if (st.errorCode === "not_found") return { status: "deleted" };
    if (st.errorCode === "token_expired" || st.errorCode === "token_invalid" || st.errorCode === "revoked") return { status: "token_error" };
    return { status: "unknown" };
  }
  if (st.isHidden) return { status: "hidden" };
  if (!st.canHide) return { status: "cannot_hide" };
  return { status: "visible" };
}

export interface RollbackResult {
  status: "rolled_back" | "dry_run" | "failed";
  reason: string;
}

/**
 * V1.27 rollback — restore ("unhide") a previously executed hide. Loads the
 * executed row, calls the unhide seam (dry-run unless `live`), flips the execution
 * to `rolled_back`, and writes rollback audit events. Failure is surfaced, never faked.
 */
export async function rollbackHide(
  input: {
    tenantId: string;
    executionId: string;
    account: { pageId?: string | null; externalId: string; accessToken?: string | null };
    live: boolean;
  },
  opts?: { transport?: FacebookHideTransport },
): Promise<RollbackResult> {
  const exec = await withTenantDb(input.tenantId, (db) => db.platformActionExecution.findFirst({ where: { id: input.executionId, tenantId: input.tenantId, status: "executed" } }));
  if (!exec || !exec.externalCommentId) return { status: "failed", reason: "no_executed_row" };

  const auditRollback = (event: string, reason: string) => withTenantDb(input.tenantId, (db) => db.auditLog.create({
    data: {
      tenantId: exec.tenantId, brandId: exec.brandId, event, actorKind: ActorKind.system,
      targetType: "platform_action_execution", targetId: exec.id,
      metadata: { actionType: "hide_comment", reason, executed: false } as never,
    },
  }));

  await auditRollback("live_hide.rollback_requested", "requested");
  const r = await unhideComment(
    { pageId: input.account.pageId ?? input.account.externalId, commentId: exec.externalCommentId, connectedAccountId: exec.connectedAccountId, itemId: exec.itemId ?? "", pageAccessToken: input.account.accessToken ?? "" },
    { dryRun: !input.live, transport: opts?.transport ?? new GraphFacebookHideTransport() },
  );
  if (r.status === "executed" || r.status === "dry_run") {
    if (r.status === "executed") {
      await withTenantDb(input.tenantId, (db) => db.platformActionExecution.update({ where: { id: exec.id }, data: { status: "rolled_back", rolledBackAt: new Date() } }));
      await auditRollback("live_hide.rolled_back", "rolled_back");
      return { status: "rolled_back", reason: "ok" };
    }
    return { status: "dry_run", reason: "rollback_dry_run" };
  }
  await auditRollback("live_hide.failed", r.providerErrorCode ?? "rollback_failed");
  return { status: "failed", reason: r.providerErrorCode ?? "rollback_failed" };
}
