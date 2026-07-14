/**
 * V1.46/47 — OBSERVABILITY primitives (pure; no DB required, run via the standard tsx runner).
 *
 * D) correlation IDs; token lifecycle classifier; metrics registry (low-cardinality + PII rejection);
 *    ops-event redaction; sink fail-safety. Proves no token/PII/high-cardinality label can enter telemetry.
 *
 * Run: pnpm observability:test
 */
import {
  classifyTokenLifecycle, MetricsRegistry, metrics,
  newCorrelationId, validateCorrelationId, resolveCorrelationId,
  redact, emitOpsEvent, setOpsSink, resetOpsSink, type OpsEvent,
  RateLimiter, ipKeyFromHeader,
} from "../../core/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const now = Date.UTC(2026, 6, 14);
  const day = 86_400_000;
  const warnMs = 7 * day;

  // ==================== TOKEN LIFECYCLE CLASSIFIER ====================
  check("token/healthy) far-future expiry → healthy", classifyTokenLifecycle(new Date(now + 30 * day), now, { warnMs }) === "healthy");
  check("token/expires_soon) within warn window → expires_soon", classifyTokenLifecycle(new Date(now + 3 * day), now, { warnMs }) === "expires_soon");
  check("token/expired) past expiry → expired", classifyTokenLifecycle(new Date(now - 1 * day), now, { warnMs }) === "expired");
  check("token/unknown-null) NULL expiry → unknown (NEVER silently healthy)", classifyTokenLifecycle(null, now, { warnMs }) === "unknown");
  check("token/unknown-nan) non-finite expiry → unknown", classifyTokenLifecycle(new Date(NaN), now, { warnMs }) === "unknown");
  check("token/boundary) exactly at warn boundary → expires_soon", classifyTokenLifecycle(now + warnMs, now, { warnMs }) === "expires_soon");

  // ==================== CORRELATION IDS ====================
  const gen = newCorrelationId("token");
  check("corr/gen bounded charset", /^token_[A-Za-z0-9_-]{1,58}$/.test(gen) && gen.length <= 64);
  check("corr/validate valid", validateCorrelationId("op_abc-123") === "op_abc-123");
  check("corr/validate rejects PII (email)", validateCorrelationId("user@example.com") === null);
  check("corr/validate rejects oversized", validateCorrelationId("x".repeat(200)) === null);
  check("corr/validate rejects spaces/injection", validateCorrelationId("a b\nc") === null && validateCorrelationId("") === null);
  check("corr/resolve mints fresh on invalid incoming", resolveCorrelationId("bad value!!", "web").startsWith("web_"));
  check("corr/resolve trusts valid incoming", resolveCorrelationId("op_trusted1", "web") === "op_trusted1");

  // ==================== METRICS REGISTRY (low-cardinality + PII rejection) ====================
  const r = new MetricsRegistry();
  r.inc("token_checks_total", { platform: "facebook_page" });
  r.inc("token_checks_total", { platform: "facebook_page" });
  r.inc("token_checks_total", { platform: "instagram_business" });
  check("metrics/counter labelled", r.getCounter("token_checks_total", { platform: "facebook_page" }) === 2 && r.getCounter("token_checks_total", { platform: "instagram_business" }) === 1);
  // High-cardinality / PII label VALUES are dropped from the key (collapse to base metric name).
  r.inc("sync_failures_total", { operation: "sync", result: "cmrkjq87v00020ajj1xndi8m3" as never }); // a cuid-shaped value
  r.inc("sync_failures_total", { operation: "sync" });
  check("metrics/high-cardinality value dropped (cuid not a label)", r.getCounter("sync_failures_total", { operation: "sync" }) === 2);
  // Disallowed label KEY (e.g. tenantId) is dropped entirely.
  r.inc("deletion_failures_total", { tenantId: "abc" } as never);
  check("metrics/disallowed label key dropped", r.getCounter("deletion_failures_total") === 1);
  r.setGauge("accounts_reconnect_required", 5);
  check("metrics/gauge", r.getGauge("accounts_reconnect_required") === 5);
  r.observe("provider_call_duration", 100); r.observe("provider_call_duration", 300);
  const h = r.getHistogram("provider_call_duration");
  check("metrics/histogram", h?.count === 2 && h?.sum === 400 && h?.min === 100 && h?.max === 300);
  check("metrics/snapshot is bounded counts only (no per-entity value)", typeof r.snapshot().counters === "object" && !JSON.stringify(r.snapshot()).includes("@"));
  check("metrics/default registry exported", typeof metrics.inc === "function");

  // ==================== OPS EVENT REDACTION + SINK FAIL-SAFETY ====================
  const red = redact({ platform: "facebook_page", accessToken: "EAAB123secret", email: "a@b.com", note: "bearer abc.def-123", ok: 1, nested: { x: 1 } });
  check("redact/token key redacted", red.accessToken === "[redacted]");
  check("redact/email key redacted", red.email === "[redacted]");
  check("redact/secret-shaped value redacted", red.note === "[redacted]");
  check("redact/safe fields pass; objects collapsed", red.platform === "facebook_page" && red.ok === 1 && red.nested === "[object]");

  // Capturing sink — prove redaction is applied at emit AND that a throwing sink never breaks emit.
  const captured: Array<{ event: OpsEvent; meta: Record<string, unknown> }> = [];
  setOpsSink({ emit: (event, meta) => captured.push({ event, meta }) });
  emitOpsEvent("provider.token_expired", { platform: "facebook_page", accessToken: "LEAK123", operation: "token_monitor" });
  check("emit/event captured", captured.length === 1 && captured[0]!.event === "provider.token_expired");
  check("emit/token redacted before sink", captured[0]!.meta.accessToken === "[redacted]" && captured[0]!.meta.platform === "facebook_page");

  let threw = false;
  setOpsSink({ emit: () => { throw new Error("sink down"); } });
  try { emitOpsEvent("worker.fatal", { reason: "x" }); } catch { threw = true; }
  check("emit/sink failure NEVER throws into caller (telemetry can't break work)", threw === false);
  resetOpsSink();

  // ==================== RATE LIMITER (bounded, fail-closed, deterministic window) ====================
  const rl = new RateLimiter({ limit: 3, windowMs: 1000, maxKeys: 100 });
  const t0 = 1_000_000;
  const results = [0, 1, 2, 3, 4].map((i) => rl.check("1.2.3.4", t0 + i));
  check("rl/allows up to the limit then denies (fail-closed)",
    results[0]!.allowed && results[1]!.allowed && results[2]!.allowed && !results[3]!.allowed && !results[4]!.allowed);
  check("rl/window resets after windowMs", rl.check("1.2.3.4", t0 + 1001).allowed === true);
  check("rl/keys are independent", rl.check("9.9.9.9", t0 + 5).allowed === true);
  // Bounded memory: spraying unique keys never grows past maxKeys.
  const rlSmall = new RateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 50 });
  for (let i = 0; i < 500; i++) rlSmall.check(`k${i}`, t0);
  check("rl/memory bounded (size never exceeds maxKeys under a spray)", rlSmall.size() <= 50);
  check("rl/ipKeyFromHeader takes first + bounds charset",
    ipKeyFromHeader("1.2.3.4, 5.6.7.8") === "1.2.3.4" && ipKeyFromHeader("bad ip!!") === "unknown" && ipKeyFromHeader(null) === "unknown");

  console.log(`\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
