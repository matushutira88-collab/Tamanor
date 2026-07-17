/**
 * V1.58.7 — lease HEARTBEAT controller (group C) + graceful SHUTDOWN controller (group F). Pure: the
 * clock, timers, heartbeat DB call, drain, and resource close are all INJECTED — no real waiting, no OS
 * signals. Proves timer cleanup, cooperative-cancel, lease-loss abort, idempotency, and deadline exit.
 *
 * Run: pnpm worker-shutdown:test
 */
import { createLeaseHeartbeat } from "../../../packages/sync/src/lease-heartbeat";
import { createShutdownController } from "../src/shutdown";
import type { LeaseHandle } from "@guardora/db";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const LEASE: LeaseHandle = { id: "lease1", connectedAccountId: "acc1", holderId: "A", generation: 1n, expiresAt: new Date(10_000) };
/** Fake manual timer: created timers are collected; a test "fires" one by calling its stored fn. */
function fakeTimerFactory() {
  const timers: Array<{ fn: () => void; ms: number; canceled: boolean }> = [];
  const setTimer = (fn: () => void, ms: number) => { const t = { fn, ms, canceled: false }; timers.push(t); return { cancel: () => { t.canceled = true; } }; };
  return { timers, setTimer, active: () => timers.filter((t) => !t.canceled).length };
}

async function heartbeatGroup() {
  console.log("Group C — heartbeat controller");

  // C21/C22/C23) start installs a timer; a tick calls heartbeat with the lease (holder+generation).
  {
    const ft = fakeTimerFactory();
    const seen: LeaseHandle[] = [];
    const hb = createLeaseHeartbeat({
      tenantId: "t", lease: LEASE, ttlMs: 300_000, intervalMs: 75_000,
      heartbeat: async (_t, lease) => { seen.push(lease); return true; },
      now: () => 0, setTimer: ft.setTimer, onEvent: () => {},
    });
    hb.start();
    check("C21) start() installs exactly one heartbeat timer", ft.timers.length === 1 && ft.timers[0]!.ms === 75_000);
    await hb.tick();
    await hb.tick();
    check("C22/C23) tick runs heartbeat with the SAME lease (holder+generation)", seen.length === 2 && seen[0]!.holderId === "A" && seen[0]!.generation === 1n);
    hb.stop();
  }

  // C24/C25/C26) heartbeat returns false (count=0) → lease lost → signal aborted → timer cleaned up.
  {
    const ft = fakeTimerFactory();
    let lostEvents = 0;
    const hb = createLeaseHeartbeat({
      tenantId: "t", lease: LEASE, ttlMs: 300_000, intervalMs: 75_000,
      heartbeat: async () => false, now: () => 0, setTimer: ft.setTimer,
      onEvent: (n) => { if (n === "sync.lease_lost") lostEvents++; },
    });
    hb.start();
    await hb.tick();
    check("C24) count=0 → leaseLost() true", hb.leaseLost() === true);
    check("C25) lease loss aborts the signal (cooperative cancel)", hb.signal.aborted === true);
    check("C26/C30) lease loss cleans up the timer (no orphan)", ft.active() === 0);
    check("C24b) exactly one lease_lost event", lostEvents === 1);
    // No further heartbeat after loss.
    let calls = 0;
    const hb2 = createLeaseHeartbeat({ tenantId: "t", lease: LEASE, ttlMs: 300_000, intervalMs: 1, heartbeat: async () => { calls++; return false; }, now: () => 0, setTimer: ft.setTimer, onEvent: () => {} });
    hb2.start(); await hb2.tick(); await hb2.tick(); await hb2.tick();
    check("C29) no heartbeat after loss", calls === 1);
  }

  // C27) after stop(), the timer is cleared and no further heartbeats run.
  {
    const ft = fakeTimerFactory();
    let calls = 0;
    const hb = createLeaseHeartbeat({ tenantId: "t", lease: LEASE, ttlMs: 300_000, intervalMs: 75_000, heartbeat: async () => { calls++; return true; }, now: () => 0, setTimer: ft.setTimer, onEvent: () => {} });
    hb.start();
    hb.stop();
    check("C27/C28) stop() clears the timer", ft.active() === 0);
    await hb.tick();
    check("C27b) no heartbeat after stop()", calls === 0);
  }

  // C-transient) a bounded number of THROWN (transient) DB errors is tolerated while the lease has not
  // expired, then fails closed. A clock past the last-known expiry fails closed immediately.
  {
    const ft = fakeTimerFactory();
    let t = 0;
    const hb = createLeaseHeartbeat({
      tenantId: "t", lease: { ...LEASE, expiresAt: new Date(1_000_000) }, ttlMs: 300_000, intervalMs: 75_000,
      heartbeat: async () => { throw new Error("db blip"); },
      now: () => t, setTimer: ft.setTimer, maxTransientFailures: 3, onEvent: () => {},
    });
    hb.start();
    await hb.tick(); check("C-transient) 1 transient failure tolerated (not lost)", hb.leaseLost() === false);
    await hb.tick(); check("C-transient) 2 transient failures tolerated", hb.leaseLost() === false);
    await hb.tick(); check("C-transient) 3rd consecutive transient failure fails closed", hb.leaseLost() === true);
  }
  {
    const ft = fakeTimerFactory();
    const hb = createLeaseHeartbeat({
      tenantId: "t", lease: { ...LEASE, expiresAt: new Date(500) }, ttlMs: 300_000, intervalMs: 75_000,
      heartbeat: async () => { throw new Error("db blip"); },
      now: () => 1_000, setTimer: ft.setTimer, maxTransientFailures: 5, onEvent: () => {},
    });
    hb.start();
    await hb.tick();
    check("C-transient) transient failure PAST last-known expiry fails closed immediately", hb.leaseLost() === true);
  }
}

async function shutdownGroup() {
  console.log("Group F — graceful shutdown controller");

  // F50/F58/F60) idempotent; a clean drain exits 0; the run promise resolves once (not per signal).
  {
    let stopped = 0, closed = 0;
    let drainResolve!: () => void;
    const drain = () => new Promise<void>((r) => { drainResolve = r; });
    const sc = createShutdownController({ deadlineMs: 25_000, stopScheduler: () => { stopped++; }, drain, closeResources: async () => { closed++; }, now: () => 0, setTimer: (fn) => ({ cancel: () => {} }), onEvent: () => {} });
    const p1 = sc.shutdown("SIGTERM");
    const p2 = sc.shutdown("SIGTERM"); // second signal joins the in-flight shutdown
    check("F50) shutdown is idempotent (same promise)", p1 === p2);
    check("F51) scheduler stopped exactly once", stopped === 1);
    check("F52) active runs get the abort signal", sc.signal.aborted === true);
    drainResolve();
    const code = await p1;
    check("F58/F60) clean drain within deadline → exit 0", code === 0);
    check("F56) resources closed exactly once", closed === 1);
  }

  // F53/F55) drain observes the signal (cooperative) — a signal-aware drain returns and we exit 0.
  {
    const drain = (signal: AbortSignal) => new Promise<void>((r) => { signal.addEventListener("abort", () => r()); });
    let sc: ReturnType<typeof createShutdownController>;
    sc = createShutdownController({ deadlineMs: 25_000, stopScheduler: () => {}, drain: () => drain(sc.signal), closeResources: async () => {}, now: () => 0, setTimer: (fn) => ({ cancel: () => {} }), onEvent: () => {} });
    const code = await sc.shutdown("SIGINT");
    check("F53) a signal-aware drain returns on abort → exit 0", code === 0);
  }

  // F59) exceeding the deadline exits non-zero (drain never resolves; the deadline timer fires).
  {
    let fired = false;
    const timers: Array<() => void> = [];
    const sc = createShutdownController({
      deadlineMs: 25_000,
      stopScheduler: () => {},
      drain: () => new Promise<void>(() => {}), // never resolves
      closeResources: async () => {},
      now: () => 0,
      setTimer: (fn) => { timers.push(fn); return { cancel: () => {} }; },
      onEvent: (n) => { if (n === "worker.shutdown_timeout") fired = true; },
    });
    const p = sc.shutdown("SIGTERM");
    timers[0]!(); // fire the deadline
    const code = await p;
    check("F59) deadline exceeded → non-zero exit code", code === 1);
    check("F59b) shutdown_timeout event emitted", fired === true);
  }

  // F-events) the lifecycle emits started + completed for a clean shutdown.
  {
    const events: string[] = [];
    const sc = createShutdownController({ deadlineMs: 10, stopScheduler: () => {}, drain: async () => {}, closeResources: async () => {}, now: () => 0, setTimer: (fn) => ({ cancel: () => {} }), onEvent: (n) => events.push(n) });
    await sc.shutdown("SIGTERM");
    check("F-events) emits shutdown_started then shutdown_completed", events[0] === "worker.shutdown_started" && events.includes("worker.shutdown_completed"));
  }
}

async function main() {
  await heartbeatGroup();
  await shutdownGroup();
  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — worker heartbeat + shutdown controllers (V1.58.7): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
