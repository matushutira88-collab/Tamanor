/**
 * V1.44 — CENTRAL, versioned AI cost estimation. All costs are INTEGER MICROS (bigint) — never a
 * float, never a hardcoded price buried in business logic. A conservative UPPER-BOUND is computed
 * before a paid request so the reservation can never under-charge.
 *
 * The numbers below are PLACEHOLDER, UNVERIFIED per-token micros for not-yet-wired provider slots.
 * They MUST be confirmed against a provider's real price sheet before that provider is enabled. An
 * unknown provider/model falls back to {@link SAFE_FALLBACK_MICROS} — a deliberately expensive
 * estimate so an unpriced paid call fails closed against the budget rather than slipping through.
 */
export const PRICING_VERSION = "2026-07-13.v1";

type ModelPricing = { inputMicrosPerToken: number; outputMicrosPerToken: number };

/**
 * provider → modelKey → per-token micros (1 micro = 1e-6 of the provider's pricing currency = USD for
 * OpenAI). `none`/`mock` are free. For openai the modelKey is the ACTUAL model (OPENAI_MODEL), so a model
 * with no entry here falls through to SAFE_FALLBACK (fail closed) — no invented price.
 */
const PRICING: Record<string, Record<string, ModelPricing>> = {
  none: { none: { inputMicrosPerToken: 0, outputMicrosPerToken: 0 } },
  mock: { mock: { inputMicrosPerToken: 0, outputMicrosPerToken: 0 } },
  // --- OpenAI (USD list price per 1M tokens → micros/token). CONFIRM against platform.openai.com/pricing
  //     before scaling; these reflect the published rates known at authoring (2026-01): gpt-4o-mini =
  //     $0.15 / 1M input, $0.60 / 1M output ⇒ 0.15 / 0.60 micros per token. Unlisted models fail closed.
  openai: {
    "gpt-4o-mini": { inputMicrosPerToken: 0.15, outputMicrosPerToken: 0.60 },
  },
};

/** Conservative fallback when a paid provider/model has no published price yet (fail closed). */
export const SAFE_FALLBACK_MICROS = 200_000n;

export function hasPricing(provider: string, modelKey: string): boolean {
  return PRICING[provider]?.[modelKey] !== undefined;
}

/**
 * Conservative upper-bound cost for one call, in integer micros. `maxInput/OutputTokens` come from
 * the plan policy so the estimate is the worst case the call could cost.
 */
export function estimateCostMicros(provider: string, modelKey: string, maxInputTokens: number, maxOutputTokens: number): bigint {
  const p = PRICING[provider]?.[modelKey];
  if (!p) return SAFE_FALLBACK_MICROS;
  const micros = Math.ceil(p.inputMicrosPerToken * Math.max(0, maxInputTokens) + p.outputMicrosPerToken * Math.max(0, maxOutputTokens));
  return BigInt(Math.max(0, micros));
}

/**
 * Finalize the ACTUAL cost from a provider's reported token usage. If the provider does not report
 * usage, callers keep the reserved estimate (never guess lower).
 */
export function actualCostMicros(provider: string, modelKey: string, inputTokens: number, outputTokens: number): bigint {
  const p = PRICING[provider]?.[modelKey];
  if (!p) return SAFE_FALLBACK_MICROS;
  const micros = Math.ceil(p.inputMicrosPerToken * Math.max(0, inputTokens) + p.outputMicrosPerToken * Math.max(0, outputTokens));
  return BigInt(Math.max(0, micros));
}
