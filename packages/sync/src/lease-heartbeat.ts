/**
 * V1.58.7 — lease HEARTBEAT controller. Keeps a long-running sync's account lease alive (so a healthy
 * long run is never spuriously taken over) AND detects loss of ownership (so a run whose lease WAS taken
 * over stops immediately and is never marked a success).
 *
 * It is a pure controller: the clock, the timer, and the heartbeat DB call are all injectable, so every
 * behaviour is provable WITHOUT real waiting or real OS timers. `tick()` runs exactly one heartbeat
 * cycle and is what the tests drive directly; `start()`/`stop()` install/clear the repeating timer.
 *
 * On loss it ABORTS its AbortSignal — the sync loop threads this signal through pagination/ingest so no
 * further work runs, and every critical DB write is additionally fenced by the lease generation. It
 * NEVER logs a token/holder/tenant — only safe counters.
 */
import { emitOpsEvent, type OpsEvent } from "@guardora/core";
import { heartbeatSyncLease, type LeaseHandle } from "@guardora/db";

export interface LeaseHeartbeatController {
  /** Aborted the moment the lease is lost (or on stop with `abortOnStop`). */
  readonly signal: AbortSignal;
  /** True once ownership has been definitively lost (a newer worker took over). */
  leaseLost(): boolean;
  /** Run exactly one heartbeat cycle. Invoked by the repeating timer AND directly by tests. */
  tick(): Promise<void>;
  /** Install the repeating timer (idempotent; no-op after loss/stop). */
  start(): void;
  /** Stop the timer — no more heartbeats. Idempotent; SAFE to call in a `finally`. */
  stop(): void;
}

export interface LeaseHeartbeatOptions {
  tenantId: string;
  lease: LeaseHandle;
  ttlMs: number;
  intervalMs: number;
  /** Injectable heartbeat (defaults to the real, generation-checked heartbeatSyncLease). */
  heartbeat?: (tenantId: string, lease: LeaseHandle, ttlMs: number, now: Date) => Promise<boolean>;
  /** Injectable monotonic clock (ms). */
  now?: () => number;
  /** Injectable timer factory (defaults to setInterval, unref'd). Returns a canceller. */
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
  /** Max consecutive TRANSIENT (thrown) heartbeat DB failures tolerated before failing closed. */
  maxTransientFailures?: number;
  /** Observability sink (safe fields only). Defaults to emitOpsEvent. */
  onEvent?: (name: OpsEvent, meta: Record<string, unknown>) => void;
}

const defaultTimer = (fn: () => void, ms: number) => {
  const t = setInterval(fn, ms);
  if (typeof t.unref === "function") t.unref();
  return { cancel: () => clearInterval(t) };
};

export function createLeaseHeartbeat(opts: LeaseHeartbeatOptions): LeaseHeartbeatController {
  const heartbeat = opts.heartbeat ?? heartbeatSyncLease;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? defaultTimer;
  const onEvent = opts.onEvent ?? emitOpsEvent;
  const maxTransientFailures = Math.max(1, opts.maxTransientFailures ?? 3);

  const ac = new AbortController();
  let lost = false;
  let stopped = false;
  let inFlight = false;
  let consecutiveFailures = 0;
  // Last-known expiry (ms). Advanced on a successful heartbeat; the floor for the fail-closed rule.
  let currentExpiry = opts.lease.expiresAt.getTime();
  let timer: { cancel: () => void } | null = null;

  const clearTimer = () => { if (timer) { timer.cancel(); timer = null; } };

  const declareLost = () => {
    if (lost) return;
    lost = true;
    clearTimer();
    // Emit BEFORE aborting so a synchronous abort listener can rely on the event ordering.
    onEvent("sync.lease_lost", { holder: "self" });
    ac.abort();
  };

  const tick = async (): Promise<void> => {
    if (lost || stopped || inFlight) return; // never overlap heartbeats; never beat after loss/stop
    inFlight = true;
    try {
      const at = new Date(now());
      let renewed: boolean;
      try {
        renewed = await heartbeat(opts.tenantId, opts.lease, opts.ttlMs, at);
      } catch {
        // Transient DB error — do NOT assume we still hold the lease. Tolerate a small, bounded number
        // of consecutive failures, but ONLY while our last-known expiry has not passed. If the lease
        // could already have expired (and thus been taken over), fail closed immediately.
        consecutiveFailures++;
        onEvent("sync.lease_heartbeat_failed", { consecutive: consecutiveFailures });
        if (consecutiveFailures >= maxTransientFailures || now() >= currentExpiry) declareLost();
        return;
      }
      if (!renewed) {
        // count=0 → a newer generation took over. Definitive loss.
        declareLost();
        return;
      }
      consecutiveFailures = 0;
      currentExpiry = now() + opts.ttlMs;
      onEvent("sync.lease_heartbeat", {});
    } finally {
      inFlight = false;
    }
  };

  return {
    signal: ac.signal,
    leaseLost: () => lost,
    tick,
    start() {
      if (timer || lost || stopped) return;
      timer = setTimer(() => { void tick(); }, opts.intervalMs);
    },
    stop() {
      stopped = true;
      clearTimer();
    },
  };
}
