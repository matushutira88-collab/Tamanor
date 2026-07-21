/**
 * V1.44B — `classifyWithUsagePolicy`: the SINGLE authoritative metered classification service. Flow:
 * cache → deterministic rules (+ local) → paid cloud fallback. The paid tier runs ONLY when the plan
 * policy allows it, the per-instance fuses pass (kill switch / circuit / RPM / concurrency), AND both
 * the GLOBAL daily reservation and the per-TENANT reservation succeed. The provider is never called
 * before BOTH reservations. On any failure/timeout both reservations are compensated (released).
 *
 * The result carries a truthful, NORMALIZED `processingStatus` + `processingReason` (never a raw
 * provider error) which the ingest layer persists on the ReputationItem.
 */
import { classifyHybrid, type HybridConfig, type HybridResult, type ClassificationInput } from "@guardora/ai";
import { resolveEffectiveUsagePolicy, POLICY_VERSION, estimateCostMicros, actualCostMicros } from "@guardora/core";
import { getPaidAiFuseConfig } from "@guardora/config";
import {
  contentVersionHash, consumeBasicUnit, reservePremiumCall, finalizePremiumCall, releaseReservation,
  cacheGet, cachePut, recordCacheHit,
  reserveGlobalDailyCall, finalizeGlobalDailyCall, releaseGlobalDailyCall,
} from "@guardora/db";
import { paidAiGuard, withTimeout } from "./paid-ai-guard";

export type ProcessingStatus =
  | "processed_rules" | "processed_local" | "processed_paid" | "cached"
  | "basic_limit_reached" | "premium_limit_reached" | "paid_ai_disabled" | "failed";

export interface MeteredCtx { tenantId: string; plan: string; accessState?: string; internalAccess?: boolean; reputationItemId?: string; contentItemId?: string; correlationId?: string }
export interface MeteredDeps {
  /** TEST-ONLY provider injection. Production uses the internal classifyHybrid (paid) path. */
  callProvider?: (input: ClassificationInput, cfg: HybridConfig) => Promise<HybridResult>;
  now?: Date;
}
export interface MeteredResult extends HybridResult {
  processingTier: "rules" | "local" | "paid";
  processingStatus: ProcessingStatus;
  processingReason?: string;
  contentHash: string;
}

const CLASSIFIER_VERSION = "risk-rules-v1";

/**
 * Run a reservation settlement/compensation DB op FAIL-OPEN. A throw here must never crash the whole
 * classification (rules must still stand) and, on the success path, must never refund/undo a paid provider
 * call the model actually performed. Worst case a settlement is retried by `recoverStaleReservations`.
 */
async function bestEffort(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch { /* settlement is best-effort — see recoverStaleReservations */ }
}

export async function classifyWithUsagePolicy(
  ctx: MeteredCtx, input: ClassificationInput, cfg: HybridConfig, deps: MeteredDeps = {},
): Promise<MeteredResult> {
  const now = deps.now ?? new Date();
  // V1.50D — billing-aware policy: a restricted/suspended tenant gets NO paid AI regardless of plan.
  const policy = resolveEffectiveUsagePolicy(ctx.plan, ctx.accessState, { internalAccess: ctx.internalAccess });
  const provider = cfg.aiRisk.provider || "none";
  // Model-specific key for openai (the real OPENAI_MODEL) so pricing + cache + reservation are per-model;
  // an unpriced model then fails closed to SAFE_FALLBACK. Other providers key by provider name.
  const modelKey = provider === "openai" && cfg.aiRisk.openai?.model ? cfg.aiRisk.openai.model : provider;
  const contentHash = contentVersionHash({
    text: input.text, rating: input.rating, context: `${input.platform}|${cfg.workspaceLocale}`,
    classifierVersion: CLASSIFIER_VERSION, policyVersion: POLICY_VERSION,
  });
  const evRefs = { reputationItemId: ctx.reputationItemId, contentItemId: ctx.contentItemId, correlationId: ctx.correlationId };
  const done = (r: HybridResult, tier: "rules" | "local" | "paid", status: ProcessingStatus, reason?: string): MeteredResult => ({ ...r, processingTier: tier, processingStatus: status, processingReason: reason, contentHash });

  // 1) CACHE — never calls a paid provider, consumes no unit.
  const cached = await cacheGet(ctx.tenantId, contentHash, modelKey, POLICY_VERSION);
  if (cached) {
    await recordCacheHit(ctx.tenantId, { idempotencyKey: `cache:${contentHash}:${modelKey}`, ...evRefs }, ctx.plan, now);
    return done(cached.normalizedResult as unknown as HybridResult, "rules", "cached");
  }

  // 2) RULES (+ local) — always free, deterministic. Consume ONE basic unit (deduped by content).
  const rules = await classifyHybrid(input, { ...cfg, aiRisk: { enabled: false, provider: "none", minConfidence: cfg.aiRisk.minConfidence, callMode: cfg.aiRisk.callMode } });
  const basic = await consumeBasicUnit(ctx.tenantId, ctx.plan, { idempotencyKey: `basic:${contentHash}`, tier: "rules", internalAccess: ctx.internalAccess, ...evRefs }, now);
  const baseStatus: ProcessingStatus = basic.denied ? "basic_limit_reached" : "processed_rules";

  // 3) PAID fallback — policy → canary allowlist → per-instance fuses → GLOBAL reserve → TENANT reserve.
  const fuse = getPaidAiFuseConfig();
  // Canary allowlist: EMPTY = inactive; NON-EMPTY = only listed tenants may reach the paid provider.
  const allowlisted = fuse.tenantAllowlist.length === 0 || fuse.tenantAllowlist.includes(ctx.tenantId);
  const wantPaid = policy.allowPaidFallback && cfg.aiRisk.enabled && provider !== "none" && allowlisted;
  if (!wantPaid) return done(rules, "rules", baseStatus, allowlisted ? basic.reason : "tenant_not_allowlisted");

  const acq = paidAiGuard.tryAcquire(now);
  if (!acq.ok) {
    // Kill switch → "paid_ai_disabled"; transient per-instance fuses → rules result + reason.
    const st: ProcessingStatus = acq.reason === "paid_ai_disabled" ? "paid_ai_disabled" : baseStatus;
    return done(rules, "rules", st, acq.reason);
  }

  try {
    const estMicros = estimateCostMicros(provider, modelKey, policy.maxInputTokensPerCall, policy.maxOutputTokensPerCall);

    // 3a) GLOBAL reserve (multi-instance safe) FIRST.
    const global = await reserveGlobalDailyCall(provider, estMicros, { callLimit: fuse.globalDailyCallLimit, costLimitMicros: fuse.globalDailyCostLimitMicros }, now);
    if (!global.ok) return done(rules, "rules", baseStatus, global.reason); // global cap → rules stands, reason surfaced

    // 3b) TENANT reserve. A THROW here (transient DB error) must ALSO release the global reserve and fall
    // back to rules — otherwise the cross-tenant global daily counter leaks for the rest of the UTC day
    // (there is no stale-recovery for the global counter). If it denies or is an idempotent retry, likewise.
    let tenant: Awaited<ReturnType<typeof reservePremiumCall>>;
    try {
      tenant = await reservePremiumCall(ctx.tenantId, ctx.plan, { provider, modelKey, estMicros, idempotencyKey: `prem:${contentHash}:${modelKey}`, internalAccess: ctx.internalAccess, ...evRefs }, now);
    } catch {
      await bestEffort(() => releaseGlobalDailyCall(provider, estMicros, now));
      return done(rules, "rules", "failed", "paid_provider_error");
    }
    if (!tenant.ok || tenant.reused) {
      await bestEffort(() => releaseGlobalDailyCall(provider, estMicros, now));
      return tenant.ok
        ? done(rules, "rules", baseStatus, "reused_reservation")
        : done(rules, "rules", "premium_limit_reached", tenant.reason);
    }

    // 3c) PROVIDER — only now, after BOTH reservations. The provider call is the ONLY refund-on-throw op;
    // everything after it is SETTLEMENT, which is best-effort and NEVER refunds a call the model performed.
    let paid: HybridResult;
    try {
      paid = await callProviderWithRetry(input, cfg, provider, deps);
    } catch (e) {
      // Timeout / thrown error → the provider did not complete → compensate BOTH (unbilled), rules stands.
      await bestEffort(() => finalizePremiumCall(ctx.tenantId, tenant.eventId, { status: "failed", billed: false }));
      await bestEffort(() => releaseGlobalDailyCall(provider, estMicros, now));
      paidAiGuard.recordFailure(now);
      const reason = (e as Error)?.message === "paid_provider_timeout" ? "paid_provider_timeout" : "paid_provider_error";
      return done(rules, "rules", "failed", reason);
    }

    const call = paid.providerCalls.find((c) => c.type === "ai_risk" && c.status !== "skipped");
    if (!call) {
      // Value-gate did not fire → provider not called → release both (unbilled). Surface the normalized
      // skip reason (admin diagnostics) instead of the basic-unit reason, unless the basic cap was hit.
      await bestEffort(() => releaseReservation(ctx.tenantId, tenant.eventId, "gate_not_fired"));
      await bestEffort(() => releaseGlobalDailyCall(provider, estMicros, now));
      return done(paid, "rules", baseStatus, basic.denied ? basic.reason : "gate_not_fired");
    }
    if (call.status === "failed" || call.status === "unavailable") {
      await bestEffort(() => finalizePremiumCall(ctx.tenantId, tenant.eventId, { status: "failed", billed: false }));
      await bestEffort(() => releaseGlobalDailyCall(provider, estMicros, now));
      paidAiGuard.recordFailure(now);
      return done(rules, "rules", "failed", "paid_provider_failed");
    }
    // Use the provider's REAL reported token usage for actual cost when available (never invented). For an
    // unpriced model this equals the conservative estimate (fail-closed) until prices are set. Settlement is
    // best-effort: a DB error settling a COMPLETED paid call must NOT refund it (would under-bill).
    const usage = paid.aiUsage;
    const actual = usage ? actualCostMicros(provider, modelKey, usage.inputTokens, usage.outputTokens) : estMicros;
    await bestEffort(() => finalizePremiumCall(ctx.tenantId, tenant.eventId, { status: "succeeded", actualCostMicros: actual, billed: true, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens }));
    await bestEffort(() => finalizeGlobalDailyCall(provider, estMicros, actual, now));
    paidAiGuard.recordSuccess();
    await bestEffort(() => cachePut(ctx.tenantId, { contentHash, modelKey, policyVersion: POLICY_VERSION, normalizedResult: paid as unknown }));
    return done(paid, "paid", "processed_paid");
  } finally {
    acq.release();
  }
}

/** Provider call with per-instance timeout + bounded retry (one reservation; never re-charges). */
async function callProviderWithRetry(input: ClassificationInput, cfg: HybridConfig, provider: string, deps: MeteredDeps): Promise<HybridResult> {
  // Preserve the FULL aiRisk config (openai key/model + callMode) — only `enabled`/`provider` are forced on
  // for the paid pass. Dropping `openai` here would rebuild the provider as `none` and silently skip the call.
  const call = deps.callProvider ?? ((i: ClassificationInput, c: HybridConfig) => classifyHybrid(i, { ...c, aiRisk: { ...c.aiRisk, enabled: true, provider } }));
  const retries = paidAiGuard.maxRetries();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(call(input, cfg), paidAiGuard.timeoutMs());
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
