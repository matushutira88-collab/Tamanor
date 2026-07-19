/**
 * V1.63 — client-side diagnostic reporters (error boundaries + dashboard mount marker). Everything here
 * is FAIL-OPEN (a reporting failure must never affect the UI) and sends only a small, allow-listed payload
 * to the same-origin diagnostics endpoint. It NEVER sends cookies, localStorage, tokens, the full URL with
 * query params, email, tenant name, raw props, or a raw stack. The httpOnly login traceId is NOT readable
 * here — the server enriches the report from the cookie.
 */

const ENDPOINT = "/api/diagnostics/client-error";
const MAX_MSG = 200;

/** Stable reference id: server digest first, else an inherited/fallback id. Pure — unit-tested. */
export function computeReferenceId(digest: string | undefined, inherited: string | undefined, fallback: string): string {
  return digest || inherited || fallback;
}

/** Dedupe key — the same error on the same route + boundary reports at most once. Pure — unit-tested. */
export function clientReportKey(referenceId: string, route: string, boundary: string): string {
  return `${referenceId}|${route}|${boundary}`;
}

/** A one-time module-level fallback id (stable within a document; boundaries also pin via useRef). */
export function newClientReference(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `t_${uuid.replace(/-/g, "").slice(0, 12)}`;
}

function alreadyReported(key: string): boolean {
  try {
    const k = "diag_reported";
    const seen = new Set<string>(JSON.parse(sessionStorage.getItem(k) ?? "[]") as string[]);
    if (seen.has(key)) return true;
    seen.add(key);
    sessionStorage.setItem(k, JSON.stringify([...seen].slice(-50)));
    return false;
  } catch {
    return false; // no sessionStorage → don't block the report (dedupe is best-effort)
  }
}

function post(body: Record<string, unknown>): void {
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true, // survive the unmount/navigation that often follows an error
      credentials: "same-origin",
    }).catch(() => { /* fail-open */ });
  } catch {
    /* fail-open */
  }
}

export interface ClientErrorReport {
  referenceId: string;
  boundary: "global" | "dashboard";
  route: string;
  errorName?: string;
  safeMessage?: string;
  digest?: string;
}

/** Report a caught render error ONCE per (referenceId, route, boundary). Never throws. */
export function reportClientError(r: ClientErrorReport): void {
  const route = (r.route || "/").split("?")[0]!.slice(0, 128);
  if (alreadyReported(clientReportKey(r.referenceId, route, r.boundary))) return;
  post({
    event: "error",
    referenceId: r.referenceId.slice(0, 64),
    boundary: r.boundary,
    route,
    errorName: r.errorName?.slice(0, 64),
    safeMessage: r.safeMessage?.slice(0, MAX_MSG),
    digest: r.digest?.slice(0, 64),
  });
}

/** Fire the one-time DASHBOARD_CLIENT_MOUNTED marker (sends the server-threaded traceId). Never throws. */
export function reportDashboardMounted(route: string, traceId?: string): void {
  const r = (route || "/dashboard").split("?")[0]!.slice(0, 128);
  if (alreadyReported(clientReportKey("mounted", r, "shell_mount"))) return;
  post({ event: "mounted", boundary: "shell_mount", route: r, traceId });
}
