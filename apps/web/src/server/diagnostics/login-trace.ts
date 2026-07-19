/**
 * Local, dependency-free redaction (mirrors @guardora/core `redact`) — kept inline so this module has NO
 * heavy transitive imports (it is dynamically loaded from `onRequestError`, which also runs on the edge
 * runtime where `node:crypto` is unavailable). Redacts secret-shaped keys/values; collapses objects.
 */
const SECRET_KEY = /(token|secret|password|cookie|authorization|database_url|app_database_url|api[_-]?key|encryption[_-]?key|email|payload)/i;
const SECRET_VALUE = /(bearer\s+[a-z0-9._-]+|postgres(?:ql)?:\/\/|plain:v1:|aesgcm:v1:|eyj[a-z0-9._-]+|@[a-z0-9.-]+\.[a-z]{2,})/i;
function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) { out[k] = "[redacted]"; continue; }
    if (typeof v === "string" && SECRET_VALUE.test(v)) { out[k] = "[redacted]"; continue; }
    out[k] = typeof v === "object" && v !== null ? "[object]" : v;
  }
  return out;
}

/**
 * V1.63 — TEMPORARY, fail-open diagnostic instrumentation for the login → first-authenticated-render
 * flow. Every helper here is defensive: a logging failure must NEVER break login or the dashboard, and
 * NEXT_REDIRECT / NEXT_NOT_FOUND control-flow is NEVER reported as an error. No password, email, token,
 * cookie value, CSRF token, Authorization header, secret, request body, or raw component prop is logged —
 * fields are projected to an allow-list and then passed through the shared `redact()` before emit.
 */

/** Short-lived httpOnly cookie that carries the login traceId to the dashboard render (never a URL param). */
export const TRACE_COOKIE = "tamanor_login_trace";
const TRACE_RE = /^t_[a-f0-9]{12,64}$/;
const TRACE_MAX_AGE_S = 300; // 5 minutes — a backstop; the client mount marker clears it sooner.
// Control-char stripper built from a STRING (no literal char-range in a regex literal, on purpose).
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]+", "g");

export type LoginPhase =
  | "LOGIN_SUBMITTED" | "USER_LOOKUP_COMPLETED" | "PASSWORD_VERIFIED" | "MEMBERSHIP_RESOLVED"
  | "SESSION_CREATED" | "COOKIE_SET" | "REDIRECT_STARTED"
  | "DASHBOARD_BOOTSTRAP_STARTED" | "SESSION_READ" | "USER_CONTEXT_RESOLVED" | "TENANT_LOADED"
  | "BILLING_LOADED" | "ENTITLEMENTS_LOADED" | "USAGE_LOADED" | "SHELL_RENDER_STARTED"
  | "DASHBOARD_BOOTSTRAP_COMPLETED" | "DASHBOARD_CLIENT_MOUNTED" | "CLIENT_ERROR" | "SERVER_REQUEST_ERROR";

/** A phase logger bound to a single traceId — threaded through the session layer (see startSession). */
export type PhaseLogger = (phase: string, meta?: Record<string, unknown>) => void;

/** Non-secret, bounded traceId. `t_` + 24 hex. crypto when available (not a secret; only needs uniqueness). */
export function newTraceId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const hex = c?.randomUUID
    ? c.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(16)}${Math.floor(Math.random() * 1e12).toString(16)}`;
  return `t_${hex.slice(0, 24)}`;
}

/** Validate an untrusted traceId (from the cookie); returns it only if well-formed, else undefined. */
export function readValidTraceId(raw: string | null | undefined): string | undefined {
  return raw && TRACE_RE.test(raw) ? raw : undefined;
}

export function traceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TRACE_MAX_AGE_S,
  };
}

function deploymentMeta(): { environment: string; deployment?: string } {
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
  const deployment = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || undefined;
  return { environment, deployment };
}

/** True for Next.js framework control-flow (redirect / notFound) — must be rethrown, never logged as error. */
export function isNextControlFlow(e: unknown): boolean {
  const d = (e as { digest?: unknown })?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d === "NEXT_NOT_FOUND" || d.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

/** Scrub an error message: drop anything secret-shaped, strip control chars/newlines, truncate to 200. */
export function scrubMessage(msg: unknown): string {
  const raw = typeof msg === "string" ? msg : "";
  const scrubbed = (redact({ v: raw }).v as string) ?? "[redacted]";
  return scrubbed.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Extract SAFE error metadata (never a raw stack in UI; safe for logs). */
export function safeErrorMeta(e: unknown): { errorClass: string; safeMessage: string; digest?: string } {
  const errorClass = (e as { name?: string })?.name
    ?? (e as { constructor?: { name?: string } })?.constructor?.name ?? "Error";
  const digest = typeof (e as { digest?: unknown })?.digest === "string" ? (e as { digest: string }).digest : undefined;
  return { errorClass, safeMessage: scrubMessage((e as { message?: unknown })?.message), digest };
}

/** Test seam: the emit sink. Default writes one structured, redacted JSON line to stdout. */
export type DiagSink = (line: Record<string, unknown>) => void;
const defaultSink: DiagSink = (line) => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
};

/** The allow-listed diagnostic fields — anything else is dropped before emit. */
export interface PhaseFields {
  traceId: string;
  phase: string;
  route?: string;
  success?: boolean;
  durationMs?: number;
  userId?: string;
  tenantId?: string;
  errorClass?: string;
  safeMessage?: string;
  digest?: string;
  boundary?: string;
  referenceId?: string;
  userAgentFamily?: string;
  // onRequestError context (safe metadata only — never headers/body).
  method?: string;
  routerKind?: string;
  routeType?: string;
  renderSource?: string;
}

const ALLOWED_FIELDS = ["traceId", "route", "success", "durationMs", "userId", "tenantId", "errorClass", "safeMessage", "digest", "boundary", "referenceId", "userAgentFamily", "method", "routerKind", "routeType", "renderSource"] as const;

/** Fail-open structured phase log. NEVER throws into the caller (diagnostics must not break the request). */
export function logPhase(fields: PhaseFields, sink: DiagSink = defaultSink): void {
  try {
    const { environment, deployment } = deploymentMeta();
    const line: Record<string, unknown> = { ts: new Date().toISOString(), diag: fields.phase, environment };
    if (deployment) line.deployment = deployment;
    // Project ONLY the allow-listed fields, then redact secret-shaped keys/values as defence-in-depth.
    for (const k of ALLOWED_FIELDS) {
      if (fields[k] !== undefined) line[k] = fields[k];
    }
    sink(redact(line));
  } catch {
    /* diagnostics must never break login/dashboard */
  }
}

/**
 * Time an async phase: log success (with durationMs) or a real error (rethrown), and RETHROW Next.js
 * control-flow (redirect/notFound) WITHOUT logging it as a failure. Fail-open on the logging itself.
 */
export async function withPhase<T>(
  traceId: string, phase: LoginPhase, fn: () => Promise<T>,
  meta: Partial<PhaseFields> = {}, sink: DiagSink = defaultSink,
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    logPhase({ traceId, phase, success: true, durationMs: Date.now() - t0, ...meta }, sink);
    return result;
  } catch (e) {
    if (isNextControlFlow(e)) throw e; // expected navigation — not a failure
    logPhase({ traceId, phase, success: false, durationMs: Date.now() - t0, ...safeErrorMeta(e), ...meta }, sink);
    throw e; // preserve original behaviour → error boundary
  }
}

/** Build a PhaseLogger bound to a traceId (threaded into the session layer for MEMBERSHIP_RESOLVED etc.). */
export function phaseLogger(traceId: string, base: Partial<PhaseFields> = {}, sink: DiagSink = defaultSink): PhaseLogger {
  return (phase, meta) => logPhase({ traceId, phase, success: true, ...base, ...(meta as Partial<PhaseFields>) }, sink);
}
