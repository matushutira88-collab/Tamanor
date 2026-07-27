/**
 * Platform Privacy Analytics V1 — import-safe ingestion core (no Next `server-only` / session dependency, so
 * it is unit-testable). Enforces same-origin, strict content-type, bounded body size, a batch cap, rate
 * limiting, and consent-aware collection, then delegates to the privacy-preserving DB service. Returns a
 * SAFE generic response (bounded counts only) — no analytics architecture is leaked. The route wrapper
 * resolves the request/session context and sets first-party cookies.
 */
import { randomUUID } from "node:crypto";
import { ingestAnalyticsEvents } from "@guardora/db";
import { ANALYTICS_LIMITS, type AnalyticsConsentMode } from "@guardora/core";

export const ANALYTICS_VISITOR_COOKIE = "ta_vid";
export const ANALYTICS_SESSION_COOKIE = "ta_sid";
export const ANALYTICS_CONSENT_COOKIE = "ta_consent";

export interface IngestContext {
  sameOrigin: boolean;
  contentType: string | null;
  userAgent: string | null;   // transient
  ip: string | null;          // transient
  visitorToken: string | null;
  sessionToken: string | null;
  consent: AnalyticsConsentMode;
  authenticatedUserState: "ANONYMOUS" | "AUTHENTICATED" | "UNKNOWN";
  tenantState: "NONE" | "HAS_TENANT" | "UNKNOWN";
  ownHosts?: readonly string[];
  now?: Date;
}
export interface SetCookie { name: string; value: string; maxAgeSec: number; }
export interface IngestResult { status: number; body: { ok: boolean }; setCookies: SetCookie[]; }

// Lightweight per-process rate limiter keyed by a coarse bucket (visitor token or a random ephemeral id).
// Production uses a shared limiter (documented); this is a safe local backstop. Exact thresholds are internal.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();
/** Tiny non-reversible transform for the in-memory rate-limit bucket key (never stores/logs the raw IP). */
function rlBucket(ip: string): string {
  let h = 5381;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) + h + ip.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function rateLimited(key: string, now: number): boolean {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) { buckets.set(key, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  b.count++;
  if (buckets.size > 10000) { for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k); } // bounded memory
  return b.count > MAX_PER_WINDOW;
}
/** Test-only reset of the rate-limiter state. */
export function __resetIngestRateLimiter(): void { buckets.clear(); }

const VISITOR_TTL = 400 * 24 * 60 * 60; // ~13 months (rotation handled server-side in the hash)
const SESSION_TTL = 30 * 60;            // 30 minutes inactivity

/** The safe generic response — identical shape for accept/reject so nothing about internals is leaked. */
const OK: IngestResult["body"] = { ok: true };

export async function handleAnalyticsIngest(rawBody: string, ctx: IngestContext): Promise<IngestResult> {
  const now = ctx.now ?? new Date();
  const setCookies: SetCookie[] = [];
  // Same-origin only — a foreign origin is silently accepted-looking but collects nothing (no enumeration).
  if (!ctx.sameOrigin) return { status: 403, body: OK, setCookies };
  // Strict content type.
  if (!ctx.contentType || !/^application\/json\b/.test(ctx.contentType) && !/^text\/plain\b/.test(ctx.contentType)) return { status: 415, body: OK, setCookies };
  // Bounded body size.
  if (typeof rawBody !== "string" || Buffer.byteLength(rawBody, "utf8") > ANALYTICS_LIMITS.maxBodyBytes) return { status: 413, body: OK, setCookies };

  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { return { status: 200, body: OK, setCookies }; }
  const events = Array.isArray((parsed as { events?: unknown })?.events) ? (parsed as { events: unknown[] }).events : Array.isArray(parsed) ? parsed : [parsed];
  if (events.length === 0 || events.length > ANALYTICS_LIMITS.maxBatch) return { status: 200, body: OK, setCookies };

  // First-party rotating tokens — only issued/used when consent is granted (no persistent id before consent).
  let visitorToken = ctx.visitorToken;
  let sessionToken = ctx.sessionToken;
  if (ctx.consent === "ENABLED") {
    if (!visitorToken) { visitorToken = randomUUID(); setCookies.push({ name: ANALYTICS_VISITOR_COOKIE, value: visitorToken, maxAgeSec: VISITOR_TTL }); }
    if (!sessionToken) { sessionToken = randomUUID(); setCookies.push({ name: ANALYTICS_SESSION_COOKIE, value: sessionToken, maxAgeSec: SESSION_TTL }); }
  } else if (ctx.consent === "WITHDRAWN") {
    // Consent withdrawn → expire any existing analytics identifiers; never reactivate silently.
    if (visitorToken) setCookies.push({ name: ANALYTICS_VISITOR_COOKIE, value: "", maxAgeSec: 0 });
    if (sessionToken) setCookies.push({ name: ANALYTICS_SESSION_COOKIE, value: "", maxAgeSec: 0 });
    visitorToken = null; sessionToken = null;
  }

  // Rate limit — key by the TRANSIENT IP first (a client can rotate the first-party visitor cookie to farm
  // fresh buckets, but not its source IP), falling back to the visitor token, then a coarse anonymous daily
  // bucket. The IP is hashed for the in-memory bucket key and is never stored/logged.
  const rlKey = ctx.ip ? `ip:${rlBucket(ctx.ip)}` : visitorToken ? `v:${visitorToken}` : `anon:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
  if (rateLimited(rlKey, now.getTime())) return { status: 429, body: OK, setCookies };

  await ingestAnalyticsEvents(events, {
    userAgent: ctx.userAgent, ip: ctx.ip, visitorToken, sessionToken, consent: ctx.consent,
    ownHosts: ctx.ownHosts, authenticatedUserState: ctx.authenticatedUserState, tenantState: ctx.tenantState, now,
  });
  return { status: 200, body: OK, setCookies };
}

/** Map a consent cookie/header value to the collection mode. */
export function consentModeFrom(value: string | null | undefined): AnalyticsConsentMode {
  if (value === "granted") return "ENABLED";
  if (value === "denied") return "DISABLED";
  if (value === "withdrawn") return "WITHDRAWN";
  return "UNKNOWN";
}
