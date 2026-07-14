import "server-only";
import { RateLimiter, ipKeyFromHeader } from "@guardora/core";
import { loadEnv } from "@guardora/config";

/**
 * V1.48P — process-wide rate limiters for public endpoints. Module-level singletons (bounded memory).
 * Public forms get a tight per-IP window; the webhook endpoint a generous one. Fail-closed at the limit.
 */
const env = loadEnv();

export const publicFormLimiter = new RateLimiter({
  limit: env.PUBLIC_FORM_RATE_LIMIT,
  windowMs: env.PUBLIC_FORM_RATE_WINDOW_MS,
  maxKeys: 10_000,
});

export const webhookLimiter = new RateLimiter({
  limit: env.WEBHOOK_RATE_LIMIT,
  windowMs: env.WEBHOOK_RATE_WINDOW_MS,
  maxKeys: 20_000,
});

export { ipKeyFromHeader };
