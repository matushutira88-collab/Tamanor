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
import { resolveUsagePolicy, POLICY_VERSION, estimateCostMicros } from "@guardora/core";
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

export interface MeteredCtx { tenantId: string; plan: string; reputationItemId?: string; contentItemId?: string; correlationId?: string }
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

export async function classifyWithUsagePolicy(
  ctx: MeteredCtx, input: ClassificationInput, cfg: HybridConfig, deps: MeteredDeps = {},
): Promise<MeteredResult> {
  const now = deps.now ?? new Date();
  const policy = resolveUsagePolicy(ctx.plan);
  const provider = cfg.aiRisk.provider || "none";
  const modelKey = provider;
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
  const rules = await classifyHybrid(input, { ...cfg, aiRisk: { enabled: false, provider: "none", minConfidence: cfg.aiRisk.minConfidence } });
  const basic = await consumeBasicUnit(ctx.tenantId, ctx.plan, { idempotencyKey: `basic:${contentHash}`, tier: "rules", ...evRefs }, now);
  const baseStatus: ProcessingStatus = basic.denied ? "basic_limit_reached" : "processed_rules";

  // 3) PAID fallback — policy → per-instance fuses → GLOBAL reserve → TENANT reserve → provider.
  const wantPaid = policy.allowPaidFallback && cfg.aiRisk.enabled && provider !== "none";
  if (!wantPaid) return done(rules, "rules", baseStatus, basic.reason);

  const acq = paidAiGuard.tryAcquire(now);
  if (!acq.ok) {
    // Kill switch → "paid_ai_disabled"; transient per-instance fuses → rules result + reason.
    const st: ProcessingStatus = acq.reason === "paid_ai_disabled" ? "paid_ai_disabled" : baseStatus;
    return done(rules, "rules", st, acq.reason);
  }

  try {
    const estMicros = estimateCostMicros(provider, modelKey, policy.maxInputTokensPerCall, policy.maxOutputTokensPerCall);
    const fuse = getPaidAiFuseConfig();

    // 3a) GLOBAL reserve (multi-instance safe) FIRST.
    const global = await reserveGlobalDailyCall(provider, estMicros, { callLimit: fuse.globalDailyCallLimit, costLimitMicros: fuse.globalDailyCostLimitMicros }, now);
    if (!global.ok) return done(rules, "rules", baseStatus, global.reason); // global cap → rules stands, reason surfaced

    // 3b) TENANT reserve. If it denies OR is an idempotent retry, compensate the global reserve.
    const tenant = await reservePremiumCall(ctx.tenantId, ctx.plan, { provider, modelKey, estMicros, idempotencyKey: `prem:${contentHash}:${modelKey}`, ...evRefs }, now);
    if (!tenant.ok || tenant.reused) {
      await releaseGlobalDailyCall(provider, estMicros, now);
      return tenant.ok
        ? done(rules, "rules", baseStatus, "reused_reservation")
        : done(rules, "rules", "premium_limit_reached", tenant.reason);
    }

    // 3c) PROVIDER — only now, after BOTH reservations. Timeout + bounded retry.
    try {
      const paid = await callProviderWithRetry(input, cfg, provider, deps);
      const call = paid.providerCalls.find((c) => c.type === "ai_risk" && c.status !== "skipped");
      if (!call) {
        // Value-gate did not fire → provider not called → release both (unbilled).
        await releaseReservation(ctx.tenantId, tenant.eventId, "gate_not_fired");
        await releaseGlobalDailyCall(provider, estMicros, now);
        return done(paid, "rules", baseStatus, basic.reason);
      }
      const failed = call.status === "failed" || call.status === "unavailable";
      if (failed) {
        await finalizePremiumCall(ctx.tenantId, tenant.eventId, { status: "failed", billed: false });
        await releaseGlobalDailyCall(provider, estMicros, now);
        paidAiGuard.recordFailure(now);
        return done(rules, "rules", "failed", "paid_provider_failed");
      }
      await finalizePremiumCall(ctx.tenantId, tenant.eventId, { status: "succeeded", actualCostMicros: estMicros, billed: true });
      await finalizeGlobalDailyCall(provider, estMicros, estMicros, now);
      paidAiGuard.recordSuccess();
      await cachePut(ctx.tenantId, { contentHash, modelKey, policyVersion: POLICY_VERSION, normalizedResult: paid as unknown });
      return done(paid, "paid", "processed_paid");
    } catch (e) {
      // Timeout / thrown error → compensate BOTH, normalize the reason (never a raw error).
      await finalizePremiumCall(ctx.tenantId, tenant.eventId, { status: "failed", billed: false });
      await releaseGlobalDailyCall(provider, estMicros, now);
      paidAiGuard.recordFailure(now);
      const reason = (e as Error)?.message === "paid_provider_timeout" ? "paid_provider_timeout" : "paid_provider_error";
      return done(rules, "rules", "failed", reason);
    }
  } finally {
    acq.release();
  }
}

/** Provider call with per-instance timeout + bounded retry (one reservation; never re-charges). */
async function callProviderWithRetry(input: ClassificationInput, cfg: HybridConfig, provider: string, deps: MeteredDeps): Promise<HybridResult> {
  const call = deps.callProvider ?? ((i: ClassificationInput, c: HybridConfig) => classifyHybrid(i, { ...c, aiRisk: { enabled: true, provider, minConfidence: c.aiRisk.minConfidence } }));
  const retries = paidAiGuard.maxRetries();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(call(input, cfg), paidAiGuard.timeoutMs());
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
