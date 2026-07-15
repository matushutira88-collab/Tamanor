import "server-only";
import { SharedRateLimiter, createRateLimitStore, ipKeyFromHeader, metrics, type RateLimitStore } from "@guardora/core";
import { loadEnv } from "@guardora/config";

/**
 * V1.51C — ONE central rate-limiter, backed by the shared distributed store. `createRateLimitStore`
 * returns the Upstash Redis store when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set
 * (consistent counting across all serverless instances), and the in-memory store otherwise (local
 * dev / single instance). All limiters share this ONE store — there is no second limiter implementation.
 *
 * Sensitive auth/email/payment limiters FAIL CLOSED (deny) if the shared store is unreachable in
 * production; non-sensitive public-form/webhook limiters degrade to allow (the Meta webhook's HMAC
 * signature remains the authoritative trust decision regardless of the limiter).
 *
 * Keys are hashed/minimized inside SharedRateLimiter (no raw IP/email persisted). Each limiter
 * namespaces its keys by name so counters never collide across limiters in the shared store.
 */
const env = loadEnv();
const store: RateLimitStore = createRateLimitStore();

class CentralLimiter {
  private inner: SharedRateLimiter;
  constructor(private name: string, opts: { limit: number; windowMs: number; failClosed: boolean }) {
    this.inner = new SharedRateLimiter(store, opts);
  }
  /** Register a hit for `key` and decide. Emits shared_rate_limit_hit / _block (low-cardinality). */
  async check(key: string): Promise<{ allowed: boolean }> {
    const d = await this.inner.check(`${this.name}:${key}`);
    metrics.inc(d.allowed ? "shared_rate_limit_hit" : "shared_rate_limit_block", { operation: this.name });
    return { allowed: d.allowed };
  }
}

/** Public forms (book-demo/contact/lead) — per-IP; degrade-to-allow if the store is down. */
export const publicFormLimiter = new CentralLimiter("public_form", {
  limit: env.PUBLIC_FORM_RATE_LIMIT, windowMs: env.PUBLIC_FORM_RATE_WINDOW_MS, failClosed: false,
});

/** Meta webhook per-IP DoS guard — generous; degrade-to-allow (HMAC signature is authoritative). */
export const webhookLimiter = new CentralLimiter("webhook", {
  limit: env.WEBHOOK_RATE_LIMIT, windowMs: env.WEBHOOK_RATE_WINDOW_MS, failClosed: false,
});

/**
 * Credential auth abuse guard (register + login + reset + oauth-start + checkout + portal + verify).
 * Checked per-IP AND per-email (distinct keys). FAIL CLOSED at the limit and if the shared store is
 * unreachable in production.
 */
export const authLimiter = new CentralLimiter("auth", { limit: 10, windowMs: 5 * 60_000, failClosed: true });

/** Outbound-email auth flows (resend verification, forgot-password) — per-IP AND per-email. Fail closed. */
export const emailSendLimiter = new CentralLimiter("email", { limit: 5, windowMs: 60 * 60_000, failClosed: true });

export { ipKeyFromHeader };
