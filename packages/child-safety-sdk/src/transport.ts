/**
 * CS-C14 — SDK transports. Default: fetch/HTTPS with timeout, AbortSignal, bounded response body, no
 * automatic cross-origin redirects, generic failure classification, and no server-internal leakage.
 * Also a deterministic in-memory transport for tests.
 */
import type { ChildSafetyTransport, TransportResponse } from "./types";

const MAX_RESPONSE_BYTES = 64 * 1024;

export class TransportError extends Error {
  constructor(public readonly failure: "network" | "timeout" | "aborted" | "server_error", message: string) {
    super(message);
    this.name = "TransportError";
  }
}

/** HTTPS-only outside localhost; timeout + abort; response body bounded; redirects rejected. */
export function createFetchTransport(opts: { allowInsecureLocalhost?: boolean } = {}): ChildSafetyTransport {
  return {
    async post(url, body, o): Promise<TransportResponse> {
      let u: URL;
      try { u = new URL(url); } catch { throw new TransportError("network", "invalid_endpoint"); }
      const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if (u.protocol !== "https:" && !(opts.allowInsecureLocalhost && isLocal)) throw new TransportError("network", "insecure_endpoint");

      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (o.signal) { if (o.signal.aborted) ctrl.abort(); else o.signal.addEventListener("abort", onAbort); }
      const timer = setTimeout(() => ctrl.abort(), Math.max(1, o.timeoutMs));
      try {
        const res = await fetch(url, { method: "POST", headers: o.headers, body, signal: ctrl.signal, redirect: "error" });
        const text = (await res.text()).slice(0, MAX_RESPONSE_BYTES);
        let json: unknown = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        return { status: res.status, json };
      } catch (e) {
        const aborted = (e as Error).name === "AbortError";
        throw new TransportError(aborted ? (o.signal?.aborted ? "aborted" : "timeout") : "network", "request_failed");
      } finally {
        clearTimeout(timer);
        if (o.signal) o.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Deterministic in-memory transport for tests. `handler` decides the response per call. */
export function createMemoryTransport(
  handler: (body: string, headers: Record<string, string>, call: number) => TransportResponse | Promise<TransportResponse>,
): ChildSafetyTransport & { calls: { body: string; headers: Record<string, string> }[] } {
  const calls: { body: string; headers: Record<string, string> }[] = [];
  return {
    calls,
    async post(_url, body, o): Promise<TransportResponse> {
      if (o.signal?.aborted) throw new TransportError("aborted", "aborted");
      const n = calls.length;
      calls.push({ body, headers: o.headers });
      return handler(body, o.headers, n);
    },
  };
}
