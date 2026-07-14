/**
 * V1.44B — PER-INSTANCE paid-AI fuses (circuit breaker, requests-per-minute, max concurrency) plus
 * the config kill switch. The DAILY hard caps (call + cost) are NOT here anymore — they live in the
 * DB-backed `global_ai_usage_periods` table (multi-instance safe). These fuses are deliberately
 * per-process backstops; the authoritative global cap and the per-tenant budget are DB-enforced.
 *
 * `tryAcquire` is synchronous and race-free within a process (single-threaded: the check + the
 * counter increments happen with no `await` between them), so concurrency can never exceed the cap.
 */
import { getPaidAiFuseConfig, type PaidAiFuseConfig } from "@guardora/config";

export type GuardResult = { ok: true; release: () => void } | { ok: false; reason: string };
type Cfg = PaidAiFuseConfig & { effectiveEnabled: boolean };

class PaidAiGuard {
  private windowMinute = -1;
  private windowCount = 0;
  private inFlight = 0;
  private failures = 0;
  private circuitOpenUntil = 0;
  private halfOpen = false;

  /**
   * Atomic per-instance pre-flight: config kill switch → circuit → RPM → concurrency. On success it
   * commits an RPM tick + a concurrency slot and returns a `release()`; on failure returns a reason.
   * The provider must NOT be called unless this returns ok (and both DB reservations then succeed).
   */
  tryAcquire(now: Date = new Date(), cfg: Cfg = getPaidAiFuseConfig()): GuardResult {
    if (!cfg.effectiveEnabled) return { ok: false, reason: "paid_ai_disabled" };

    if (this.circuitOpenUntil > 0) {
      if (now.getTime() < this.circuitOpenUntil) return { ok: false, reason: "provider_circuit_open" };
      // Cooldown elapsed → allow a single half-open probe.
      this.circuitOpenUntil = 0;
      this.halfOpen = true;
    }

    const minute = Math.floor(now.getTime() / 60_000);
    const count = minute === this.windowMinute ? this.windowCount : 0;
    if (count + 1 > cfg.rpmLimit) return { ok: false, reason: "rpm_limit" };
    if (this.inFlight >= cfg.maxConcurrency) return { ok: false, reason: "max_concurrency" };

    // Commit (single-threaded → atomic).
    this.windowMinute = minute;
    this.windowCount = count + 1;
    this.inFlight++;
    let released = false;
    return { ok: true, release: () => { if (!released) { released = true; this.inFlight = Math.max(0, this.inFlight - 1); } } };
  }

  recordSuccess() { this.failures = 0; this.halfOpen = false; this.circuitOpenUntil = 0; }

  recordFailure(now: Date = new Date(), cfg: Cfg = getPaidAiFuseConfig()) {
    if (this.halfOpen) { this.halfOpen = false; this.circuitOpenUntil = now.getTime() + cfg.circuitCooldownMs; this.failures = 0; return; }
    this.failures++;
    if (this.failures >= cfg.circuitFailureThreshold) { this.circuitOpenUntil = now.getTime() + cfg.circuitCooldownMs; this.failures = 0; }
  }

  timeoutMs(cfg: Cfg = getPaidAiFuseConfig()): number { return cfg.timeoutMs; }
  maxRetries(cfg: Cfg = getPaidAiFuseConfig()): number { return cfg.maxRetries; }

  /** Diagnostic snapshot (per-instance; no secrets). */
  snapshot(now: Date = new Date()) {
    return { inFlight: this.inFlight, circuitOpen: now.getTime() < this.circuitOpenUntil || this.circuitOpenUntil > 0, windowCount: this.windowCount, failures: this.failures };
  }
  /** TEST-ONLY reset. */
  reset() { this.windowMinute = -1; this.windowCount = 0; this.inFlight = 0; this.failures = 0; this.circuitOpenUntil = 0; this.halfOpen = false; }
}

export const paidAiGuard = new PaidAiGuard();

/** Reject a provider call that exceeds the per-instance timeout (frees the concurrency slot). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("paid_provider_timeout")), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
