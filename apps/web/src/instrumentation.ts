import type { Instrumentation } from "next";

/**
 * V1.48P — Next.js instrumentation hook: runs ONCE at server startup (both node + edge runtimes).
 * Initializes the vendor-neutral observability sink so ops events are emitted as safe structured
 * stdout lines from the very first request. Fail-safe: never throws (startup must not break).
 */
export async function register(): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const { initOpsSink } = await import("@guardora/core");
      initOpsSink("web", process.env.NODE_ENV ?? "development");
    }
  } catch {
    /* observability init must never break startup */
  }
}

/** Read a single cookie value from a raw Cookie header (no dependency; safe against odd inputs). */
function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const h = Array.isArray(header) ? header.join("; ") : header;
  if (!h) return undefined;
  for (const part of h.split(/; */)) {
    const eq = part.indexOf("=");
    if (eq > -1 && part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1)); } catch { return part.slice(eq + 1); }
    }
  }
  return undefined;
}

/**
 * V1.63 — server error observability. Logs ONE safe structured line per request error, correlated to the
 * login flow via the httpOnly trace cookie when present. Logs only safe metadata (digest, route, method,
 * router kind / render source, error class, sanitized message, traceId) — NEVER headers or the request
 * body. Next.js does not call this for redirect/notFound control-flow; we guard again defensively.
 * Fail-open: observability must never throw into the request path.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    const { logPhase, readValidTraceId, isNextControlFlow, safeErrorMeta, TRACE_COOKIE } = await import("./server/diagnostics/login-trace");
    if (isNextControlFlow(error)) return; // expected navigation — not a real error
    const traceId = readValidTraceId(readCookie(request.headers?.cookie, TRACE_COOKIE));
    const { errorClass, safeMessage, digest } = safeErrorMeta(error);
    logPhase({
      traceId: traceId ?? "t_none",
      phase: "SERVER_REQUEST_ERROR",
      success: false,
      route: context?.routePath || request?.path,
      method: request?.method,
      routerKind: context?.routerKind,
      routeType: context?.routeType,
      renderSource: context?.renderSource,
      errorClass,
      safeMessage,
      digest,
    });
  } catch {
    /* observability must never break the request */
  }
};
