/**
 * V1.58.7 — graceful SHUTDOWN controller for the long-running worker. Extracted as a pure,
 * unit-testable unit: signals, the clock, the deadline timer, the drain, and resource close are all
 * injectable, so every behaviour is provable WITHOUT real OS signals or real waiting.
 *
 * On shutdown it: (1) stops the scheduler + rejects new runs synchronously, (2) aborts its signal so
 * active runs cooperatively cancel (the sync loop threads this into pagination/ingest and finalizes
 * `interrupted`, never success), (3) awaits active work up to a hard deadline, (4) closes resources,
 * (5) resolves an EXIT CODE — 0 when it drained cleanly, non-zero when it hit the deadline. It is
 * idempotent: a second SIGTERM/SIGINT joins the in-flight shutdown instead of starting a new one.
 */
import type { OpsEvent } from "@guardora/core";

export interface ShutdownController {
  /** Aborted the instant shutdown begins → active runs cooperatively cancel. */
  readonly signal: AbortSignal;
  isShuttingDown(): boolean;
  /** Begin (or join) shutdown. Idempotent. Resolves to the process exit code (0 clean / non-0 deadline). */
  shutdown(reason: string): Promise<number>;
}

export interface ShutdownOptions {
  /** Hard drain deadline in ms. Exceeding it resolves a non-zero exit code. */
  deadlineMs: number;
  /** Stop the scheduler / refuse new runs. Called synchronously, first, before awaiting anything. */
  stopScheduler: () => void;
  /** Await in-flight work. MUST observe `signal` so it returns promptly once runs cancel. */
  drain: () => Promise<void>;
  /** Close DB clients / health server / timers. Best-effort; errors are swallowed. */
  closeResources: () => Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
  onEvent?: (name: OpsEvent, meta: Record<string, unknown>) => void;
}

const defaultTimer = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  if (typeof t.unref === "function") t.unref();
  return { cancel: () => clearTimeout(t) };
};

export function createShutdownController(opts: ShutdownOptions): ShutdownController {
  const setTimer = opts.setTimer ?? defaultTimer;
  const onEvent = opts.onEvent ?? (() => {});
  const ac = new AbortController();
  let shuttingDown = false;
  let inFlight: Promise<number> | null = null;

  async function run(reason: string): Promise<number> {
    // 1) Stop accepting new work + cancel active runs. Synchronous and immediate.
    onEvent("worker.shutdown_started", { reason });
    try { opts.stopScheduler(); } catch { /* stopping must never throw out of shutdown */ }
    ac.abort();

    // 2) Race the drain against the hard deadline. The drain must observe `signal` to return promptly.
    const timerRef: { current: { cancel: () => void } | null } = { current: null };
    const deadline = new Promise<"timeout">((resolve) => {
      timerRef.current = setTimer(() => resolve("timeout"), Math.max(1, opts.deadlineMs));
    });
    const drained = opts.drain().then(() => "drained" as const, () => "drained" as const);
    const outcome = await Promise.race([drained, deadline]);
    timerRef.current?.cancel();

    // 3) Close resources (best-effort — never let a close error change the exit verdict).
    await opts.closeResources().catch(() => {});

    if (outcome === "timeout") {
      onEvent("worker.shutdown_timeout", { reason });
      return 1;
    }
    onEvent("worker.shutdown_completed", { reason });
    return 0;
  }

  return {
    signal: ac.signal,
    isShuttingDown: () => shuttingDown,
    shutdown(reason: string): Promise<number> {
      if (inFlight) return inFlight; // idempotent: a second signal joins the in-flight shutdown
      shuttingDown = true;
      inFlight = run(reason);
      return inFlight;
    },
  };
}
