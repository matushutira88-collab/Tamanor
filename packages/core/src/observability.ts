/**
 * V1.46/47 — vendor-neutral observability primitives. PURE + dependency-free (lives in @guardora/core
 * so both the web app and the worker share ONE implementation). Nothing here performs I/O beyond the
 * pluggable ops sink (default: one safe structured log line). Designed so that NO token, secret, PII,
 * provider body, or high-cardinality identifier can enter telemetry.
 */

// ---------------------------------------------------------------------------
// 1) Structured operational events (bounded catalog) + hard secret redaction.
// ---------------------------------------------------------------------------
export type OpsEvent =
  // provider / token lifecycle
  | "provider.token_expires_soon"
  | "provider.token_expired"
  | "provider.token_validation_failed"
  | "provider.token_renewed"
  | "provider.reconnect_required"
  | "provider.rate_limited"
  // webhook
  | "webhook.signature_invalid"
  | "webhook.processing_failed"
  | "webhook.retention_failed"
  | "webhook.replay"
  // oauth / account discovery
  | "oauth.discovery_failed"
  // V1.58.6 — Meta Graph HTTP resilience (never carries token/secret/proof/URL/payload)
  | "meta.request_timeout"
  | "meta.request_retry"
  | "meta.rate_limited"
  | "meta.auth_error"
  // sync
  | "sync.failed"
  | "sync.partial"
  | "sync.stale_completion"
  // V1.58.7 — sync lease heartbeat + fencing lifecycle (never carry token/holder secret/tenant id).
  | "sync.lease_acquired"
  | "sync.lease_heartbeat"
  | "sync.lease_heartbeat_failed"
  | "sync.lease_lost"
  | "sync.fencing_rejected"
  | "sync.interrupted"
  | "sync.completed"
  // V1.58.8 — Vercel-native Cron job runtime (no secrets; only operation/result/trigger labels).
  | "cron.dispatch.started"
  | "cron.dispatch.completed"
  | "cron.job.started"
  | "cron.job.completed"
  | "cron.deadline_checkpoint"
  | "cron.unauthorized"
  // lifecycle deletions
  | "tenant.deletion_failed"
  | "user.erasure_failed"
  | "lead.erasure_failed"
  // platform / infra
  | "worker.maintenance_failed"
  | "worker.fatal"
  // V1.58.7 — worker fail-closed startup + graceful shutdown lifecycle (no secret values ever).
  | "worker.config_invalid"
  | "worker.starting"
  | "worker.ready"
  | "worker.shutdown_started"
  | "worker.shutdown_completed"
  | "worker.shutdown_timeout"
  // V1.51 — worker liveness: a positive heartbeat so "worker stopped / heartbeat missing" is
  // detectable by staleness (not only by the ABSENCE of logs). Carries no PII/ids.
  | "worker.heartbeat"
  | "rls.health_failed"
  | "service.readiness_failed"
  | "db.unavailable"
  | "web.5xx"
  // V1.50C — email verification / password recovery (never carry email, token, URL, or body).
  | "auth.email_delivery_failed"
  | "auth.verification_failed"
  | "auth.password_reset_failed"
  | "auth.token_cleanup_failed"
  // V1.58.9 — session lifecycle audit (never carry password, session/reset/verification token, or cookie).
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.session_expired_idle"
  | "auth.session_expired_absolute"
  | "auth.session_rotated"
  | "auth.session_revoked"
  // V1.58.9 phase 2 — full auth audit (no secret/token/Turnstile-token/cookie ever).
  | "auth.login_blocked"
  | "auth.registration_completed"
  | "auth.registration_blocked"
  | "auth.email_verified"
  | "auth.password_changed"
  | "auth.password_reset_requested"
  | "auth.password_reset_completed"
  | "auth.logout_all"
  | "auth.bot_challenge"
  | "auth.turnstile_failed"
  | "auth.breached_password_blocked"
  | "auth.security_email_sent"
  // V1.66 — PER-MEMBER onboarding lifecycle. Meta carries only userId, tenantId, the onboarding version
  // and a numeric progress count — never a checklist payload, comment, message or e-mail content.
  | "onboarding.started"
  | "onboarding.dismissed"
  | "onboarding.resumed"
  | "onboarding.completed"
  | "onboarding.restarted"
  // V1.51B — Google Workspace transactional email transport (never carry recipient, credential,
  // access/refresh token, body, action URL, raw Gmail response, or Google project/client id).
  | "email.send_succeeded"
  | "email.send_failed"
  | "email.refresh_failed"
  | "email.rate_limited"
  | "email.configuration_invalid"
  | "email.provider_unavailable"
  // V1.50D — subscription billing (never carry payment PII, card, email, or Stripe response body).
  | "billing.checkout_failed"
  | "billing.portal_failed"
  | "billing.webhook_signature_invalid"
  | "billing.webhook_failed"
  | "billing.webhook_stale"
  | "billing.subscription_activated"
  | "billing.subscription_canceled"
  | "billing.payment_failed"
  | "billing.access_restricted"
  // V1.50E — entitlement enforcement (only plan/operation/result/reason labels; never PII/IDs).
  | "entitlement.denied"
  | "entitlement.limit_reached"
  | "entitlement.restricted_blocked"
  // V1.50F — route locking, restricted sync pause, atomic limits (low-cardinality labels only).
  | "route.capability_denied"
  | "sync.restricted_skipped"
  | "webhook.sync_skipped"
  // V1.59 — watched-account + protection product model (low-cardinality labels; never a token/secret).
  | "account.monitoring_enabled"
  | "account.monitoring_disabled"
  | "account.connected"
  | "account.disconnected"
  | "account.sync_requested"
  | "account.sync_completed"
  | "account.sync_failed"
  | "account.permissions_expired"
  | "protection.rules_updated"
  | "protection.auto_hide_enabled"
  | "protection.auto_hide_disabled"
  | "protection.action_executed"
  | "protection.action_failed"
  | "protection.simulation_run"
  | "subscription.account_limit_reached"
  | "subscription.monitoring_limit_enforced"
  | "report.exported"
  | "limit.concurrent_contention"
  | "limit.over_limit_detected"
  // BUSINESS-VAULT-V1 — provider credential vault + Meta lead-ingestion (only operation/result labels; NEVER a
  // token, ciphertext, wrapped key, IV, tag, email, phone, name, message, OAuth code, app secret, or raw body).
  | "connector.vault_write_failed"
  | "business.meta_lead_ingested"
  | "business.meta_lead_duplicate"
  | "business.meta_lead_rejected"
  | "business.meta_lead_fetch_failed"
  // BUSINESS-LEADGEN-SUBSCRIPTION-V1 — Page↔app `leadgen` webhook subscription (only operation/result/reason
  // labels; NEVER a token, app secret, appsecret proof, raw Meta body, or a tenant/account/Page id).
  | "business.meta_leadgen_subscription_verified"
  | "business.meta_leadgen_subscription_failed"
  // BUSINESS-LEADGEN-ONBOARDING-V1 — one event per Facebook Page processed by a connect/reconnect. Carries the
  // bounded outcome enum in `result` and nothing else: never a Page/account/tenant id, token or Graph message.
  | "business.meta_page_onboarded"
  // A submitted asset that did not match the server-side OAuth asset list (count only, never the value).
  | "business.meta_asset_selection_rejected";

/** Low-cardinality label keys allowed on ops events + metrics. Anything else is a cardinality risk. */
// V1.50F — `plan` + `capability` added for entitlement/route observability (both LOW cardinality:
// ~5 plans, ~5 capabilities). Never a tenant/user/provider id.
// V1.51B — `template` + `locale` + `environment` for transactional-email observability (LOW
// cardinality: a handful of templates, 3 locales, 3 environments). Never a recipient/credential.
export type SafeLabel = "platform" | "result" | "operation" | "env" | "reason" | "severity" | "plan" | "capability" | "template" | "locale" | "environment";

const SECRET_KEY = /(token|secret|password|cookie|authorization|database_url|app_database_url|api[_-]?key|encryption[_-]?key|email|payload)/i;
const SECRET_VALUE = /(bearer\s+[a-z0-9._-]+|postgres(?:ql)?:\/\/|plain:v1:|aesgcm:v1:|eyj[a-z0-9._-]+|@[a-z0-9.-]+\.[a-z]{2,})/i;

/** Redact secret-shaped keys/values from event metadata before emit. Objects are collapsed (never serialized). */
export function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) { out[k] = "[redacted]"; continue; }
    if (typeof v === "string" && SECRET_VALUE.test(v)) { out[k] = "[redacted]"; continue; }
    out[k] = typeof v === "object" && v !== null ? "[object]" : v;
  }
  return out;
}

/**
 * Recursive privacy-safe redaction for STRUCTURED diagnostics (deeper than the single-level `redact`). Walks
 * nested objects/arrays with hard bounds (depth, breadth, string length, key count), reuses the same
 * SECRET_KEY/SECRET_VALUE rules, handles circular references, and never throws. This is ADDITIVE — it does not
 * replace `redact` (the ops-event path + its tests rely on `redact` collapsing objects to "[object]").
 */
export interface RedactDeepOptions { maxDepth?: number; maxArray?: number; maxString?: number; maxKeys?: number }
const RD_DEFAULTS = { maxDepth: 6, maxArray: 100, maxString: 2048, maxKeys: 100 };
// Extra PII shapes redacted ONLY by the deep redactor (not the shared `redact`): phone-like runs + IPv4.
const PII_VALUE = /(\+?\d[\d\s().-]{9,}\d|\b\d{1,3}(?:\.\d{1,3}){3}\b)/;
export function redactDeep(value: unknown, options: RedactDeepOptions = {}): unknown {
  const o = { ...RD_DEFAULTS, ...options };
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number, keyHint?: string): unknown => {
    if (keyHint !== undefined && SECRET_KEY.test(keyHint)) return "[redacted]";
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === "string") {
      const s = v as string;
      if (SECRET_VALUE.test(s) || PII_VALUE.test(s)) return "[redacted]";
      return s.length > o.maxString ? `${s.slice(0, o.maxString)}…[truncated]` : s;
    }
    if (t === "number" || t === "boolean") return v;
    if (t === "bigint") return `${(v as bigint).toString()}n`;
    if (t === "function" || t === "symbol") return `[${t}]`;
    if (v instanceof Error) return { name: v.name, message: walk(v.message, depth + 1, "message") };
    if (t === "object") {
      if (seen.has(v as object)) return "[circular]";
      seen.add(v as object);
      if (depth >= o.maxDepth) return "[depth-limited]";
      if (Array.isArray(v)) {
        const arr: unknown[] = v.slice(0, o.maxArray).map((item) => walk(item, depth + 1));
        if (v.length > o.maxArray) arr.push(`…+${v.length - o.maxArray} more`);
        return arr;
      }
      const out: Record<string, unknown> = {};
      let n = 0;
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (n++ >= o.maxKeys) { out["…"] = "[keys-limited]"; break; }
        out[k] = walk(val, depth + 1, k);
      }
      return out;
    }
    return "[unknown]";
  };
  try { return walk(value, 0); } catch { return "[redaction-error]"; }
}

/**
 * Emit a privacy-safe STRUCTURED diagnostic line (one JSON object) for critical operational events — release/
 * provenance failures, an authenticated deployment/readiness probe, an audited file-response, or a scheduler
 * aggregate result. Top-level fields are bounded; `detail` passes through `redactDeep`. Fail-safe: never throws.
 */
export interface SafeLogRecord {
  event: string;
  severity?: "info" | "warn" | "error";
  releaseSha?: string | null;
  deploymentId?: string | null;
  correlationId?: string | null;
  routeTemplate?: string | null;
  outcome?: string | null;
  detail?: Record<string, unknown>;
}
export function emitSafeLog(record: SafeLogRecord): void {
  try {
    const line = {
      ts: new Date().toISOString(),
      log: String(record.event).slice(0, 120),
      severity: record.severity ?? "info",
      ...(record.releaseSha ? { releaseSha: String(record.releaseSha).slice(0, 64) } : {}),
      ...(record.deploymentId ? { deploymentId: String(record.deploymentId).slice(0, 128) } : {}),
      ...(record.correlationId ? { correlationId: String(record.correlationId).slice(0, 64) } : {}),
      ...(record.routeTemplate ? { route: String(record.routeTemplate).slice(0, 200) } : {}),
      ...(record.outcome ? { outcome: String(record.outcome).slice(0, 120) } : {}),
      ...(record.detail ? { detail: redactDeep(record.detail) } : {}),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  } catch { /* diagnostics must never break a request/job */ }
}

export interface OpsSink {
  emit(event: OpsEvent, meta: Record<string, unknown>): void;
}

/** Default sink: a single safe structured log line. Swap for a vendor sink at startup via setOpsSink. */
const consoleSink: OpsSink = {
  emit(event, meta) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ ts: new Date().toISOString(), ops: event, ...redact(meta) }));
  },
};

let sink: OpsSink = consoleSink;
export function setOpsSink(s: OpsSink): void { sink = s; }
export function resetOpsSink(): void { sink = consoleSink; }

/** Emit an ops event. Fail-safe: a broken sink NEVER throws into the caller (telemetry must not break work). */
export function emitOpsEvent(event: OpsEvent, meta: Record<string, unknown> = {}): void {
  try { sink.emit(event, redact(meta)); } catch { /* telemetry must never break a request/job */ }
}

/**
 * V1.48P — a production structured-log sink: one safe JSON line per event, tagged with the service +
 * environment, already redacted. This is the vendor-neutral default operators centralize from stdout;
 * a real vendor sink can replace it at startup via setOpsSink without touching call sites. It swallows
 * its own errors so a logging failure can never break a request/job (fail-safe).
 */
export function makeStructuredOpsSink(service: string, env: string): OpsSink {
  return {
    emit(event, meta) {
      try {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ts: new Date().toISOString(), service, env, ops: event, ...redact(meta) }));
      } catch { /* sink must never throw */ }
    },
  };
}

/** Idempotently install the production structured sink (called once at web/worker startup). */
let opsInitialized = false;
export function initOpsSink(service: string, env: string): void {
  if (opsInitialized) return;
  setOpsSink(makeStructuredOpsSink(service, env));
  opsInitialized = true;
}

// ---------------------------------------------------------------------------
// 2) Correlation IDs — bounded, non-PII. Generate our own; validate untrusted incoming ones.
// ---------------------------------------------------------------------------
const CORRELATION_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Generate a new correlation id. `rand` is injectable for deterministic tests. */
export function newCorrelationId(prefix = "op", rand: () => string = defaultRand): string {
  const safePrefix = /^[a-z]{1,12}$/i.test(prefix) ? prefix : "op";
  return `${safePrefix}_${rand()}`;
}
function defaultRand(): string {
  // Non-crypto is fine — a correlation id is not a secret; it only needs to be unique-enough + bounded.
  return Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

/**
 * Validate an INCOMING correlation id (e.g. an inbound `x-correlation-id` header). Returns the id only
 * if it is bounded + charset-safe (prevents log-injection / unbounded label expansion / PII smuggling);
 * otherwise returns null so the caller mints a fresh trusted one.
 */
export function validateCorrelationId(raw: unknown): string | null {
  return typeof raw === "string" && CORRELATION_RE.test(raw) ? raw : null;
}

/** Trust an incoming id if valid, else mint a fresh one. */
export function resolveCorrelationId(raw: unknown, prefix = "op"): string {
  return validateCorrelationId(raw) ?? newCorrelationId(prefix);
}

// ---------------------------------------------------------------------------
// 3) Token lifecycle classifier — PURE timestamp logic (no provider HTTP, never fabricates expiry).
// ---------------------------------------------------------------------------
export type TokenLifecycle = "healthy" | "expires_soon" | "expired" | "unknown";

export interface TokenLifecycleWindows {
  /** Warn this long before expiry (expires_soon). */
  warnMs: number;
}

/**
 * Classify a stored token by its expiry. A NULL/missing expiry is `unknown` (NEVER silently `healthy`) —
 * the caller decides the reconnect policy for unknown. Never invents an expiry.
 */
export function classifyTokenLifecycle(expiresAt: Date | number | null | undefined, now: number, windows: TokenLifecycleWindows): TokenLifecycle {
  if (expiresAt == null) return "unknown";
  const exp = typeof expiresAt === "number" ? expiresAt : expiresAt.getTime();
  if (!Number.isFinite(exp)) return "unknown";
  if (exp <= now) return "expired";
  if (exp - now <= Math.max(0, windows.warnMs)) return "expires_soon";
  return "healthy";
}

// ---------------------------------------------------------------------------
// 4) Vendor-neutral in-process metrics registry. Low-cardinality labels ONLY.
// ---------------------------------------------------------------------------
/** Label VALUES that are cardinality/PII risks (ids, emails, tokens). Rejected — never become labels. */
const HIGH_CARDINALITY_VALUE = /(@|:\/\/|^[0-9a-f-]{16,}$|^c[a-z0-9]{20,}$|bearer|token)/i;
const ALLOWED_LABEL_KEYS = new Set<string>(["platform", "result", "operation", "env", "reason", "severity", "template", "locale", "environment"]);

export type MetricLabels = Partial<Record<SafeLabel, string>>;

function labelKey(name: string, labels?: MetricLabels): string {
  if (!labels) return name;
  const parts: string[] = [];
  for (const k of Object.keys(labels).sort()) {
    if (!ALLOWED_LABEL_KEYS.has(k)) continue; // drop disallowed keys (cardinality safety)
    const v = String((labels as Record<string, string>)[k] ?? "");
    if (v === "" || HIGH_CARDINALITY_VALUE.test(v) || v.length > 32) continue; // drop risky values
    parts.push(`${k}=${v}`);
  }
  return parts.length ? `${name}{${parts.join(",")}}` : name;
}

export interface HistogramSnapshot { count: number; sum: number; min: number; max: number }

/** A tiny, dependency-free metrics registry. Counters + gauges + histograms, safe labels only. */
export class MetricsRegistry {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private hist = new Map<string, HistogramSnapshot>();

  inc(name: string, labels?: MetricLabels, by = 1): void {
    const k = labelKey(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }
  setGauge(name: string, value: number, labels?: MetricLabels): void {
    this.gauges.set(labelKey(name, labels), value);
  }
  observe(name: string, value: number, labels?: MetricLabels): void {
    const k = labelKey(name, labels);
    const h = this.hist.get(k) ?? { count: 0, sum: 0, min: Infinity, max: -Infinity };
    h.count += 1; h.sum += value; h.min = Math.min(h.min, value); h.max = Math.max(h.max, value);
    this.hist.set(k, h);
  }
  getCounter(name: string, labels?: MetricLabels): number { return this.counters.get(labelKey(name, labels)) ?? 0; }
  getGauge(name: string, labels?: MetricLabels): number | undefined { return this.gauges.get(labelKey(name, labels)); }
  getHistogram(name: string, labels?: MetricLabels): HistogramSnapshot | undefined { return this.hist.get(labelKey(name, labels)); }
  /** A safe, bounded snapshot (counts only — never a per-entity value). */
  snapshot(): { counters: Record<string, number>; gauges: Record<string, number>; histograms: Record<string, HistogramSnapshot> } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(this.hist),
    };
  }
  reset(): void { this.counters.clear(); this.gauges.clear(); this.hist.clear(); }
}

/** Process-wide default registry (in-process; a vendor exporter can read snapshot() later). */
export const metrics = new MetricsRegistry();
