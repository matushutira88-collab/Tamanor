/**
 * Platform Privacy Analytics V1 — first-party, privacy-preserving website analytics SERVICE (server-only).
 * Ingestion, server-side conversions, deterministic daily aggregation, and bounded retention.
 *
 * Privacy by construction:
 *  - Visitor/session identifiers are server-derived, KEYED (HMAC-SHA256), NON-REVERSIBLE, ROTATING (monthly
 *    salt) pseudonyms. The keyed secret comes from env and is NEVER exposed to the client. Raw first-party
 *    tokens are hashed and discarded — never persisted. In consent-disabled/withdrawn/unknown mode NO stable
 *    identifier is used (a coarse daily anonymous bucket → aggregate page counting only, no cross-day tracking).
 *  - IP is processed TRANSIENTLY server-side for coarse country only, then discarded — never persisted/logged.
 *  - The user-agent is classified into broad categories and DISCARDED — never persisted.
 *  - Stored rows carry ONLY the bounded, allow-listed, low-cardinality fields (no raw IP/UA/query/referrer/
 *    form/email/token/fingerprint/Child-Safety/tenant-private data). Enforced by the core validator + here.
 */
import { createHmac, randomUUID } from "node:crypto";
import { systemDb } from "./index";
import {
  validateIngestEvent, normalizeAnalyticsPath, sanitizeCampaignValue, normalizeCountryCode, normalizeLanguage,
  classifyBotFromUA, classifyDeviceFromUA, classifyBrowserFromUA, classifyOSFromUA, categorizeReferrerHost,
  isAnalyticsEventType, isConversionEvent, ANALYTICS_LIMITS, ENGAGED_SESSION_MIN_EVENTS,
  type AnalyticsEventType, type AnalyticsConsentMode,
} from "@guardora/core";

// ── Keyed identifier derivation (server-only secret; never sent to the client) ──
function analyticsKey(): string {
  const k = process.env.TAMANOR_ANALYTICS_HASH_KEY;
  if (k && k.length >= 16) return k;
  if (process.env.NODE_ENV === "production") throw new Error("TAMANOR_ANALYTICS_HASH_KEY is required in production (keyed, server-only analytics identifier secret).");
  return "dev-only-analytics-hmac-key-not-for-production"; // non-prod deterministic fallback (documented)
}
const hmac = (input: string): string => createHmac("sha256", analyticsKey()).update(input).digest("hex").slice(0, 48);
/** Monthly rotation bucket (UTC) — part of the visitor salt so a pseudonym rotates and is non-linkable across months. */
const monthBucket = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const dayBucket = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

export interface AnalyticsIdentifiers { visitorIdHash: string; sessionIdHash: string; }
/**
 * Derive the (rotating, non-reversible) visitor + session hashes. With consent ENABLED and first-party
 * tokens present, they are stable keyed HMACs (rotating monthly for the visitor). Otherwise a coarse daily
 * ANONYMOUS bucket is used so events are counted in aggregate but cannot be linked across days or to a person.
 */
export function deriveAnalyticsIdentifiers(ctx: { visitorToken?: string | null; sessionToken?: string | null; consent: AnalyticsConsentMode; now: Date }): AnalyticsIdentifiers {
  if (ctx.consent === "ENABLED" && ctx.visitorToken && ctx.sessionToken) {
    return {
      visitorIdHash: hmac(`v:${ctx.visitorToken}:${monthBucket(ctx.now)}`),
      sessionIdHash: hmac(`s:${ctx.sessionToken}`),
    };
  }
  // Non-consent / essential mode — daily anonymous bucket (no cross-day tracking, no personal identification).
  const day = dayBucket(ctx.now);
  return { visitorIdHash: hmac(`anon-v:${day}`), sessionIdHash: hmac(`anon-s:${day}`) };
}

/** Transient coarse country from an IP (server-only). NEVER persists/logs the IP. Local dev → UNKNOWN. */
export function deriveCountryFromIpTransient(ip: string | null | undefined): string {
  if (!ip) return "UNKNOWN";
  // A production deployment wires a GeoIP lookup here (country-only). Locally we do not invent data.
  // The IP is used ONLY within this function call and is discarded on return — never stored or logged.
  void ip;
  return "UNKNOWN";
}

// ── Ingestion ─────────────────────────────────────────────────────────────────
export interface AnalyticsRequestContext {
  userAgent?: string | null;   // transient — classified then discarded
  ip?: string | null;          // transient — coarse country then discarded
  visitorToken?: string | null;
  sessionToken?: string | null;
  consent: AnalyticsConsentMode;
  ownHosts?: readonly string[];
  authenticatedUserState?: "ANONYMOUS" | "AUTHENTICATED" | "UNKNOWN";
  tenantState?: "NONE" | "HAS_TENANT" | "UNKNOWN";
  now?: Date;
}
export interface IngestOutcome { accepted: number; rejected: number; }

/**
 * Ingest a bounded batch of first-party events. Fail-SOFT (a bad item is dropped, never throws to the caller)
 * and returns only bounded counts — no analytics architecture is leaked. Consent-aware; UA/IP are transient.
 */
export async function ingestAnalyticsEvents(events: unknown, ctx: AnalyticsRequestContext): Promise<IngestOutcome> {
  const now = ctx.now ?? new Date();
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0 || list.length > ANALYTICS_LIMITS.maxBatch) return { accepted: 0, rejected: list.length };

  const bot = classifyBotFromUA(ctx.userAgent);
  const deviceCategory = classifyDeviceFromUA(ctx.userAgent, bot);
  const browserFamily = classifyBrowserFromUA(ctx.userAgent);
  const operatingSystemFamily = classifyOSFromUA(ctx.userAgent);
  const countryCode = deriveCountryFromIpTransient(ctx.ip);
  const ids = deriveAnalyticsIdentifiers({ visitorToken: ctx.visitorToken, sessionToken: ctx.sessionToken, consent: ctx.consent, now });

  const rows: Array<Record<string, unknown>> = [];
  let rejected = 0;
  for (const raw of list) {
    const v = validateIngestEvent(raw);
    if (!v.valid) { rejected++; continue; }
    const e = raw as Record<string, unknown>;
    // In non-consent mode only aggregate page counting is permitted (no CTA/conversion-context linkage).
    const consented = ctx.consent === "ENABLED";
    if (!consented && !(e.eventType === "PAGE_VIEW" || e.eventType === "ERROR_PAGE_VIEWED")) { rejected++; continue; }
    const referrerCategory = e.referrerCategory
      ? String(e.referrerCategory)
      : categorizeReferrerHost(typeof e.referrerHost === "string" ? e.referrerHost : null, ctx.ownHosts ?? []);
    rows.push({
      occurredAt: typeof e.occurredAt === "string" && !Number.isNaN(Date.parse(e.occurredAt)) ? new Date(e.occurredAt) : now,
      receivedAt: now,
      eventType: e.eventType,
      normalizedPath: normalizeAnalyticsPath(e.path) ?? "/",
      referrerCategory,
      campaignSource: consented ? sanitizeCampaignValue(e.campaignSource) : null,
      campaignMedium: consented ? sanitizeCampaignValue(e.campaignMedium) : null,
      campaignName: consented ? sanitizeCampaignValue(e.campaignName) : null,
      deviceCategory, browserFamily, operatingSystemFamily, countryCode,
      language: normalizeLanguage(typeof e.language === "string" ? e.language : null),
      sessionIdHash: ids.sessionIdHash, visitorIdHash: ids.visitorIdHash,
      authenticatedUserState: ctx.authenticatedUserState ?? "UNKNOWN",
      tenantState: ctx.tenantState ?? "UNKNOWN",
      conversionContext: "NONE",
      botClassification: bot,
      pageLoadCategory: typeof e.pageLoadCategory === "string" ? e.pageLoadCategory : "UNKNOWN",
    });
  }
  if (rows.length === 0) return { accepted: 0, rejected };
  try {
    const res = await systemDb.websiteAnalyticsEvent.createMany({ data: rows as never });
    return { accepted: res.count, rejected };
  } catch {
    return { accepted: 0, rejected: list.length }; // analytics failure is soft
  }
}

// ── Server-side conversions (recorded from successful domain actions; idempotent) ──
export interface ConversionContext {
  authenticatedUserState?: "ANONYMOUS" | "AUTHENTICATED" | "UNKNOWN";
  tenantState?: "NONE" | "HAS_TENANT" | "UNKNOWN";
  path?: string;
  now?: Date;
}
const CONVERSION_CTX: Record<string, string> = {
  REGISTRATION_COMPLETED: "REGISTRATION", LOGIN_COMPLETED: "LOGIN", CONTACT_FORM_SUBMITTED: "CONTACT", INTEGRATION_CONNECT_COMPLETED: "INTEGRATION",
};
/**
 * Record a conversion server-side from a successful domain action. Idempotent via a server-supplied key
 * (a repeat retry does NOT double-count). Stores ONLY the bounded conversion event — no email/name/form
 * content, OAuth tokens, Child Safety data, or tenant-private content. NEVER throws to the caller (an
 * analytics failure must not break the primary business action).
 */
export async function recordConversion(eventType: AnalyticsEventType, idempotencyKey: string, ctx: ConversionContext = {}): Promise<{ recorded: boolean }> {
  try {
    if (!isAnalyticsEventType(eventType) || !isConversionEvent(eventType) || !idempotencyKey) return { recorded: false };
    const now = ctx.now ?? new Date();
    // Idempotency: unique key insert; a conflict means already counted.
    try {
      await systemDb.websiteAnalyticsConversionIdempotency.create({ data: { idempotencyKey: idempotencyKey.slice(0, 200), eventType } });
    } catch {
      return { recorded: false }; // duplicate → not re-counted
    }
    await systemDb.websiteAnalyticsEvent.create({ data: {
      occurredAt: now, receivedAt: now, eventType, normalizedPath: normalizeAnalyticsPath(ctx.path ?? "/") ?? "/",
      referrerCategory: "INTERNAL", deviceCategory: "UNKNOWN", browserFamily: "Unknown", operatingSystemFamily: "Unknown",
      countryCode: "UNKNOWN", language: "und",
      // Server conversions are not visitor-linked — a per-event non-tracking hash keeps them countable but anonymous.
      sessionIdHash: hmac(`conv-s:${idempotencyKey}`), visitorIdHash: hmac(`conv-v:${idempotencyKey}`),
      authenticatedUserState: ctx.authenticatedUserState ?? "UNKNOWN", tenantState: ctx.tenantState ?? "UNKNOWN",
      conversionContext: CONVERSION_CTX[eventType] ?? "NONE", botClassification: "HUMAN_LIKELY", pageLoadCategory: "UNKNOWN",
    } });
    return { recorded: true };
  } catch {
    return { recorded: false }; // never break the primary action
  }
}

// ── Deterministic daily aggregation (idempotent upsert) ───────────────────────
export const RAW_RETENTION_DAYS = 90;
export const AGGREGATE_RETENTION_DAYS = 730; // 24 months

const utcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Recompute daily aggregates for a UTC date range from raw events. Deterministic + idempotent: it deletes the
 * date's aggregate rows and rebuilds them, so re-running yields the identical result. Approximate-unique
 * visitors = distinct visitorIdHash per (day, dimension). Sessions/bounces/engaged derived from session hashes.
 */
export async function runAnalyticsAggregation(input: { from: Date; to: Date; now?: Date } ): Promise<{ daysProcessed: number; aggregatesUpserted: number }> {
  const now = input.now ?? new Date();
  const run = await systemDb.websiteAnalyticsRetentionRun.create({ data: { runType: "aggregation", status: "running", windowStart: utcDay(input.from), windowEnd: utcDay(input.to), startedAt: now } });
  let days = 0, upserts = 0;
  try {
    for (let d = utcDay(input.from); d.getTime() <= utcDay(input.to).getTime(); d = new Date(d.getTime() + 86400000)) {
      const dayEnd = new Date(d.getTime() + 86400000);
      const events = await systemDb.websiteAnalyticsEvent.findMany({
        where: { occurredAt: { gte: d, lt: dayEnd } },
        select: { eventType: true, normalizedPath: true, referrerCategory: true, campaignSource: true, deviceCategory: true, browserFamily: true, operatingSystemFamily: true, countryCode: true, language: true, authenticatedUserState: true, botClassification: true, visitorIdHash: true, sessionIdHash: true, conversionContext: true },
      });
      // Group by the full dimension tuple.
      const groups = new Map<string, { dim: Record<string, string>; pageViews: number; errorPageViews: number; conversions: number; visitors: Set<string>; sessions: Map<string, number> }>();
      for (const e of events) {
        const dim = { normalizedPath: e.normalizedPath, eventType: e.eventType, referrerCategory: e.referrerCategory, campaignSource: e.campaignSource ?? "", deviceCategory: e.deviceCategory, browserFamily: e.browserFamily, operatingSystemFamily: e.operatingSystemFamily, countryCode: e.countryCode, language: e.language, authenticatedUserState: e.authenticatedUserState, botClassification: e.botClassification };
        const key = Object.values(dim).join("");
        let g = groups.get(key);
        if (!g) { g = { dim, pageViews: 0, errorPageViews: 0, conversions: 0, visitors: new Set(), sessions: new Map() }; groups.set(key, g); }
        if (e.eventType === "PAGE_VIEW") g.pageViews++;
        if (e.eventType === "ERROR_PAGE_VIEWED") g.errorPageViews++;
        if (e.conversionContext !== "NONE") g.conversions++;
        g.visitors.add(e.visitorIdHash);
        g.sessions.set(e.sessionIdHash, (g.sessions.get(e.sessionIdHash) ?? 0) + 1);
      }
      // Idempotent rebuild for this day.
      await systemDb.websiteAnalyticsDailyAggregate.deleteMany({ where: { date: d } });
      for (const g of groups.values()) {
        const sessionCounts = [...g.sessions.values()];
        const sessions = sessionCounts.length;
        const bounces = sessionCounts.filter((c) => c <= 1).length;
        const engagedSessions = sessionCounts.filter((c) => c >= ENGAGED_SESSION_MIN_EVENTS).length;
        await systemDb.websiteAnalyticsDailyAggregate.create({ data: {
          date: d, ...g.dim,
          pageViews: g.pageViews, sessions, approximateUniqueVisitors: g.visitors.size,
          conversions: g.conversions, bounces, engagedSessions, errorPageViews: g.errorPageViews,
        } as never });
        upserts++;
      }
      days++;
    }
    await systemDb.websiteAnalyticsRetentionRun.update({ where: { id: run.id }, data: { status: "completed", aggregatesUpserted: upserts, completedAt: new Date() } });
    return { daysProcessed: days, aggregatesUpserted: upserts };
  } catch (e) {
    await systemDb.websiteAnalyticsRetentionRun.update({ where: { id: run.id }, data: { status: "failed", completedAt: new Date() } }).catch(() => {});
    throw e;
  }
}

/** Delete raw events older than the retention window (batched, idempotent, audited via a run record). */
export async function runAnalyticsRetention(input: { now?: Date; rawRetentionDays?: number; batchSize?: number } = {}): Promise<{ rawEventsDeleted: number }> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - (input.rawRetentionDays ?? RAW_RETENTION_DAYS) * 86400000);
  const batch = Math.min(Math.max(100, input.batchSize ?? 5000), 20000);
  const run = await systemDb.websiteAnalyticsRetentionRun.create({ data: { runType: "retention", status: "running", windowEnd: cutoff, startedAt: now } });
  let deleted = 0;
  try {
    // Batched deletion so a large purge never runs as one huge statement.
    for (;;) {
      const ids = (await systemDb.websiteAnalyticsEvent.findMany({ where: { occurredAt: { lt: cutoff } }, select: { id: true }, take: batch })).map((r) => r.id);
      if (ids.length === 0) break;
      const res = await systemDb.websiteAnalyticsEvent.deleteMany({ where: { id: { in: ids } } });
      deleted += res.count;
      if (ids.length < batch) break;
    }
    // Also expire stale conversion-idempotency guards beyond the raw window (they are no longer needed).
    await systemDb.websiteAnalyticsConversionIdempotency.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});
    await systemDb.websiteAnalyticsRetentionRun.update({ where: { id: run.id }, data: { status: "completed", rawEventsDeleted: deleted, completedAt: new Date() } });
    return { rawEventsDeleted: deleted };
  } catch (e) {
    await systemDb.websiteAnalyticsRetentionRun.update({ where: { id: run.id }, data: { status: "failed", rawEventsDeleted: deleted, completedAt: new Date() } }).catch(() => {});
    throw e;
  }
}

export function analyticsIdempotencyKey(kind: string, ref: string): string {
  return hmac(`idem:${kind}:${ref}`);
}
export function newAnalyticsRef(): string { return randomUUID(); }
