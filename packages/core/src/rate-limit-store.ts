/**
 * V1.51B — SHARED-STORE rate limiting for a multi-instance production launch.
 *
 * The in-process {@link RateLimiter} (rate-limit.ts) is per-instance: across N serverless instances
 * the effective limit is N×. For sensitive auth/email abuse paths a full public launch needs a limit
 * that is consistent across instances. This module defines the store CONTRACT + two implementations:
 *
 *   - {@link InMemoryRateLimitStore} — the default/fallback (single instance or store-unavailable).
 *   - {@link UpstashRateLimitStore}  — production shared store over the Upstash Redis REST API
 *                                      (fetch; no SDK). Fixed-window counter (INCR + PEXPIRE).
 *
 * Keys are hashed/minimized before they reach the store (no raw IP/email persisted). Sensitive paths
 * FAIL CLOSED (deny) when the shared store is unreachable. Wiring this into the auth/email limiters is
 * an operator activation step gated on Upstash credentials being present — see createRateLimitStore.
 */
import { createHash } from "node:crypto";

export interface RateLimitDecision {
  allowed: boolean;
  /** Current count in the active window (best-effort; may be approximate on the fallback path). */
  count: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

export interface RateLimitStore {
  readonly name: string;
  /** Register one hit for `key` in a `windowMs` fixed window and decide against `limit`. */
  hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision>;
}

/** Hash a caller-supplied key (IP/email/etc.) so the store never holds a raw identifier. */
export function minimizeKey(raw: string): string {
  return createHash("sha256").update(raw).digest("base64url").slice(0, 24);
}

/** In-process fixed-window store. Bounded map with expiry eviction. The default + fallback. */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly name = "memory";
  private windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private maxKeys = 20_000) {}
  async hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision> {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      if (this.windows.size >= this.maxKeys) {
        // Evict expired first, else the oldest insertion (bounded memory).
        for (const [k, v] of this.windows) { if (v.resetAt <= now) this.windows.delete(k); }
        if (this.windows.size >= this.maxKeys) this.windows.delete(this.windows.keys().next().value as string);
      }
      this.windows.set(key, w);
    }
    w.count += 1;
    return { allowed: w.count <= limit, count: w.count, resetAt: w.resetAt };
  }
}

/**
 * Upstash Redis REST fixed-window store. Uses the pipeline endpoint to run INCR + PEXPIRE atomically
 * enough for a fixed window. On ANY transport error the caller's fail policy decides (see SharedRateLimiter).
 * Never logs the token or the raw key.
 */
export class UpstashRateLimitStore implements RateLimitStore {
  readonly name = "upstash";
  constructor(private url: string, private token: string) {}
  async hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision> {
    const redisKey = `rl:${key}`;
    const resp = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify([["INCR", redisKey], ["PEXPIRE", redisKey, windowMs, "NX"]]),
    });
    if (!resp.ok) throw new Error(`upstash_${resp.status}`);
    const out = (await resp.json()) as Array<{ result?: number }>;
    const count = Number(out?.[0]?.result ?? 0);
    return { allowed: count <= limit, count, resetAt: Date.now() + windowMs };
  }
}

/**
 * A store-backed limiter. `failClosed` (default true for sensitive auth/email paths) means: if the
 * shared store throws (unreachable), DENY rather than silently allowing an abuse burst. A non-sensitive
 * path may set failClosed=false to degrade to "allow" when the store is down.
 */
export class SharedRateLimiter {
  constructor(private store: RateLimitStore, private opts: { windowMs: number; limit: number; failClosed?: boolean }) {}
  async check(rawKey: string): Promise<RateLimitDecision> {
    const key = minimizeKey(rawKey);
    try {
      return await this.store.hit(key, this.opts.windowMs, this.opts.limit);
    } catch {
      const failClosed = this.opts.failClosed ?? true;
      return { allowed: !failClosed, count: this.opts.limit + 1, resetAt: Date.now() + this.opts.windowMs };
    }
  }
}

/**
 * Resolve the production store from env: Upstash when BOTH `UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN` are present, else the in-memory fallback (truthfully per-instance).
 * OPERATOR ACTIVATION: provision Upstash (or a KV-compatible Redis), set those two vars, and the
 * shared limiter is used automatically — no code change.
 */
export function createRateLimitStore(env: Record<string, string | undefined> = process.env): RateLimitStore {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? new UpstashRateLimitStore(url, token) : new InMemoryRateLimitStore();
}
