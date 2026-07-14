/**
 * V1.48P — bounded, dependency-free fixed-window rate limiter (pure, testable). In-memory: it protects
 * a SINGLE instance and its memory is HARD-BOUNDED (never grows past maxKeys — an attacker spraying
 * unique keys cannot exhaust memory). It fails CLOSED: at/over the limit, requests are denied.
 *
 * Multi-instance note: with N instances the effective global limit is N × limit (per-instance). This
 * is a safe, no-dependency DoS guard for the pilot; a shared-store (Redis/DB) limiter for GLOBALLY
 * exact limits is the documented scale follow-up.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** ms until the current window resets. */
  resetMs: number;
}

export interface RateLimiterOptions {
  /** Max requests allowed per key per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /** Hard cap on tracked keys (bounded memory). Oldest/expired keys are evicted past this. */
  maxKeys: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(opts: RateLimiterOptions) {
    this.limit = Math.max(1, Math.floor(opts.limit));
    this.windowMs = Math.max(1, Math.floor(opts.windowMs));
    this.maxKeys = Math.max(1, Math.floor(opts.maxKeys));
  }

  /** Record a hit for `key` and decide allow/deny. `now` is injectable for deterministic tests. */
  check(key: string, now: number = Date.now()): RateLimitResult {
    if (this.hits.size >= this.maxKeys) this.evict(now);
    const e = this.hits.get(key);
    if (!e || now - e.windowStart >= this.windowMs) {
      // New window (also caps memory: a stale key is overwritten, not accumulated).
      this.hits.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: this.limit - 1, resetMs: this.windowMs };
    }
    const resetMs = this.windowMs - (now - e.windowStart);
    if (e.count >= this.limit) return { allowed: false, remaining: 0, resetMs };
    e.count += 1;
    return { allowed: true, remaining: this.limit - e.count, resetMs };
  }

  /** Current tracked-key count (for a bounded metrics gauge; never exceeds maxKeys after eviction). */
  size(): number { return this.hits.size; }

  private evict(now: number): void {
    // 1) drop expired windows.
    for (const [k, v] of this.hits) if (now - v.windowStart >= this.windowMs) this.hits.delete(k);
    // 2) if still at/over the cap, drop the oldest-inserted keys (Map preserves insertion order).
    if (this.hits.size >= this.maxKeys) {
      let toDrop = this.hits.size - this.maxKeys + 1;
      for (const k of this.hits.keys()) { if (toDrop-- <= 0) break; this.hits.delete(k); }
    }
  }
}

/** Normalize an untrusted client-IP header into a bounded, safe rate-limit key. */
export function ipKeyFromHeader(forwardedFor: string | null | undefined, fallback = "unknown"): string {
  if (!forwardedFor) return fallback;
  // x-forwarded-for: "client, proxy1, proxy2" → take the first, bound its length + charset.
  const first = String(forwardedFor).split(",")[0]?.trim() ?? "";
  return /^[A-Za-z0-9:._-]{1,45}$/.test(first) ? first : fallback;
}
