/**
 * V1.39 — vendor-neutral operational event interface. This is the ONE place ops
 * signals are emitted. Today it writes a safe structured log line; a real monitoring
 * vendor can be wired in later WITHOUT touching call sites. No paid vendor is added.
 *
 * It hard-redacts anything secret-shaped, so a careless caller cannot leak a token,
 * cookie, Authorization header, DB URL or password into telemetry.
 */
export type OpsEvent =
  | "web.5xx"
  | "worker.fatal"
  | "db.unavailable"
  | "rls.unhealthy"
  | "sync.failed"
  | "sync.partial"
  | "token.expired"
  | "reconnect.required"
  | "provider.rate_limited"
  | "webhook.signature_invalid"
  | "webhook.replay"
  | "provider.action_failed"
  | "queue.backlog";

const SECRET_KEY = /(token|secret|password|cookie|authorization|database_url|app_database_url|api[_-]?key|encryption[_-]?key)/i;
const SECRET_VALUE = /(bearer\s+[a-z0-9._-]+|postgres(?:ql)?:\/\/|plain:v1:|aesgcm:v1:|eyj[a-z0-9._-]+)/i;

/** Redact secret-shaped keys/values from an event's metadata before it is emitted. */
export function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) { out[k] = "[redacted]"; continue; }
    if (typeof v === "string" && SECRET_VALUE.test(v)) { out[k] = "[redacted]"; continue; }
    out[k] = typeof v === "object" && v !== null ? "[object]" : v;
  }
  return out;
}

export interface OpsSink {
  emit(event: OpsEvent, meta: Record<string, unknown>): void;
}

/** Default sink: a single safe structured log line. Swap for a vendor sink later. */
const consoleSink: OpsSink = {
  emit(event, meta) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ ts: new Date().toISOString(), ops: event, ...redact(meta) }));
  },
};

let sink: OpsSink = consoleSink;
export function setOpsSink(s: OpsSink): void { sink = s; }

export function emitOpsEvent(event: OpsEvent, meta: Record<string, unknown> = {}): void {
  try { sink.emit(event, meta); } catch { /* telemetry must never break a request */ }
}
