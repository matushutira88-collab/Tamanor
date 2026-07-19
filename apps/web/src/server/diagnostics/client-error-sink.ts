import { logPhase, scrubMessage, type DiagSink } from "./login-trace";

/**
 * V1.63 — PURE handler for the client-error diagnostics sink, decoupled from Next request plumbing so it
 * is fully unit-testable AND dependency-free. The route handler gathers same-origin / rate-limit / UA-family
 * / trace-cookie and calls this. It accepts ONLY a small allow-listed JSON payload (STRICT — any unknown key
 * is rejected), caps the body, sanitizes the message, and logs allow-listed fields. It never reflects input,
 * never accepts cookies/tokens/PII, and never authenticates.
 */

const MAX_BODY = 2048; // chars — anything larger is rejected before JSON parse.
const TRACE_RE = /^t_[a-f0-9]{12,64}$/;
const EVENTS = new Set(["error", "mounted"]);
const BOUNDARIES = new Set(["global", "dashboard", "shell_mount"]);
const ALLOWED_KEYS = new Set(["event", "traceId", "referenceId", "route", "boundary", "errorName", "safeMessage", "digest", "ts"]);

interface ClientReport {
  event: "error" | "mounted";
  traceId?: string;
  referenceId?: string;
  route?: string;
  boundary?: string;
  errorName?: string;
  safeMessage?: string;
  digest?: string;
}

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/** Strict manual validation — rejects unknown keys, wrong types, over-length values, bad enums/ids. */
function parseReport(raw: string): ClientReport | null {
  if (raw.length > MAX_BODY) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!ALLOWED_KEYS.has(k)) return null; // strict: no extra fields
  if (o.event !== undefined && !(typeof o.event === "string" && EVENTS.has(o.event))) return null;
  if (o.traceId !== undefined && !(typeof o.traceId === "string" && TRACE_RE.test(o.traceId))) return null;
  if (o.boundary !== undefined && !(typeof o.boundary === "string" && BOUNDARIES.has(o.boundary))) return null;
  if (o.referenceId !== undefined && !str(o.referenceId, 64)) return null;
  if (o.route !== undefined && !str(o.route, 128)) return null;
  if (o.errorName !== undefined && !str(o.errorName, 64)) return null;
  if (o.safeMessage !== undefined && !str(o.safeMessage, 400)) return null;
  if (o.digest !== undefined && !str(o.digest, 64)) return null;
  if (o.ts !== undefined && typeof o.ts !== "number") return null;
  return {
    event: (o.event as "error" | "mounted") ?? "error",
    traceId: o.traceId as string | undefined,
    referenceId: o.referenceId as string | undefined,
    route: o.route as string | undefined,
    boundary: o.boundary as string | undefined,
    errorName: o.errorName as string | undefined,
    safeMessage: o.safeMessage as string | undefined,
    digest: o.digest as string | undefined,
  };
}

export interface ClientReportInput {
  rawBody: string;
  sameOrigin: boolean;
  rateAllowed: boolean;
  /** Derived SERVER-side from the request UA header (never trusted from the client). */
  userAgentFamily?: string;
  /** Validated trace id from the httpOnly cookie (server-read; ties the report to the login flow). */
  cookieTraceId?: string;
}

export interface ClientReportResult {
  status: number;
  /**
   * Whether the route handler should delete the login trace cookie. V1.63.1: the mount marker NO LONGER
   * clears it — an error can surface immediately AFTER mount and CLIENT_ERROR must still be able to fall
   * back to the cookie. The cookie self-expires via its 300s Max-Age (a dedicated stabilization marker
   * could clear it later, but that is intentionally out of scope here). So this is currently always false.
   */
  clearTraceCookie: boolean;
}

/** Validate + log a client diagnostic report. Pure + fail-open (logging errors never change the status). */
export function handleClientErrorReport(input: ClientReportInput, sink?: DiagSink): ClientReportResult {
  if (!input.sameOrigin) return { status: 403, clearTraceCookie: false };
  if (!input.rateAllowed) return { status: 429, clearTraceCookie: false };
  if (typeof input.rawBody !== "string" || input.rawBody.length > MAX_BODY) return { status: 413, clearTraceCookie: false };

  const d = parseReport(input.rawBody);
  if (!d) return { status: 400, clearTraceCookie: false };

  // V1.63.1 — the SERVER-THREADED traceId (rendered into the shell, echoed in the payload and already
  // validated against TRACE_RE in parseReport) is AUTHORITATIVE. The httpOnly cookie is only a fallback
  // for when the client could not carry it (e.g. an error before the shell prop was available). This makes
  // DASHBOARD_CLIENT_MOUNTED / CLIENT_ERROR correlate to the id the dashboard was actually rendered with,
  // independent of any cookie clear/expiry between render and report.
  const traceId = d.traceId ?? input.cookieTraceId ?? "t_none";
  const traceSource = d.traceId ? "payload" : input.cookieTraceId ? "cookie" : "none";

  logPhase(
    {
      traceId,
      traceSource,
      phase: d.event === "mounted" ? "DASHBOARD_CLIENT_MOUNTED" : "CLIENT_ERROR",
      route: d.route ? d.route.split("?")[0]!.slice(0, 128) : undefined,
      boundary: d.boundary,
      referenceId: d.referenceId,
      errorClass: d.errorName,
      safeMessage: d.safeMessage ? scrubMessage(d.safeMessage) : undefined,
      digest: d.digest,
      userAgentFamily: input.userAgentFamily,
      success: d.event === "mounted",
    },
    sink,
  );
  return { status: 204, clearTraceCookie: false };
}
