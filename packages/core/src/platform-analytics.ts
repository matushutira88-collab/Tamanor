/**
 * Tamanor Platform Privacy Analytics V1 — PURE first-party analytics vocabulary, strict validation, and
 * privacy-preserving classification. This is the shared contract for the ingestion API, the server pipeline,
 * the aggregation job, and the admin analytics UI. It contains NO I/O, NO clock, NO randomness, and NO
 * `node:crypto` (keyed identifier derivation lives on the server boundary only).
 *
 * This is Tamanor's OWN first-party analytics (server-stored, privacy-safe) — DISTINCT from the third-party
 * provider bridge in `./analytics` (GA4 / Meta Pixel). It stores only anonymous, low-cardinality, bounded
 * signals. It NEVER captures raw IP, precise geolocation, raw query strings, raw referrer URLs, long-term raw
 * user-agent, form content, message content, emails/names/phones, Child Safety data, tenant-private content,
 * cookies/tokens, device fingerprints, or advertising identifiers — enforced by construction below.
 */

// ── Server-controlled event allowlist (clients can NEVER submit a free-form event name) ──
export const ANALYTICS_EVENT_TYPES = [
  "PAGE_VIEW", "SESSION_START", "SESSION_END", "CTA_CLICK",
  "REGISTRATION_STARTED", "REGISTRATION_COMPLETED", "LOGIN_COMPLETED",
  "CONTACT_FORM_STARTED", "CONTACT_FORM_SUBMITTED",
  "INTEGRATION_CONNECT_STARTED", "INTEGRATION_CONNECT_COMPLETED",
  "PRICING_VIEWED", "DOCS_VIEWED", "ERROR_PAGE_VIEWED",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];
export const isAnalyticsEventType = (v: unknown): v is AnalyticsEventType => typeof v === "string" && (ANALYTICS_EVENT_TYPES as readonly string[]).includes(v);

/** Conversion events recorded server-side from successful domain actions (never trusted from the browser). */
export const CONVERSION_EVENT_TYPES: readonly AnalyticsEventType[] = ["REGISTRATION_COMPLETED", "LOGIN_COMPLETED", "CONTACT_FORM_SUBMITTED", "INTEGRATION_CONNECT_COMPLETED"];
export const isConversionEvent = (t: string): boolean => (CONVERSION_EVENT_TYPES as readonly string[]).includes(t);

// ── Bounded classification enums (broad categories only — never fingerprinting inputs) ──
export const REFERRER_CATEGORIES = ["DIRECT", "ORGANIC_SEARCH", "SOCIAL", "REFERRAL", "EMAIL", "PAID", "INTERNAL", "UNKNOWN"] as const;
export type ReferrerCategory = (typeof REFERRER_CATEGORIES)[number];
export const DEVICE_CATEGORIES = ["DESKTOP", "MOBILE", "TABLET", "BOT", "UNKNOWN"] as const;
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];
export const BROWSER_FAMILIES = ["Chrome", "Safari", "Firefox", "Edge", "Other", "Unknown"] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];
export const OS_FAMILIES = ["iOS", "Android", "macOS", "Windows", "Linux", "Other", "Unknown"] as const;
export type OsFamily = (typeof OS_FAMILIES)[number];
export const BOT_CLASSIFICATIONS = ["HUMAN_LIKELY", "KNOWN_BOT", "SUSPECTED_BOT", "UNKNOWN"] as const;
export type BotClassification = (typeof BOT_CLASSIFICATIONS)[number];
export const AUTHENTICATED_USER_STATES = ["ANONYMOUS", "AUTHENTICATED", "UNKNOWN"] as const;
export type AuthenticatedUserState = (typeof AUTHENTICATED_USER_STATES)[number];
export const TENANT_STATES = ["NONE", "HAS_TENANT", "UNKNOWN"] as const;
export type TenantState = (typeof TENANT_STATES)[number];
export const CONVERSION_CONTEXTS = ["NONE", "REGISTRATION", "LOGIN", "CONTACT", "INTEGRATION", "PRICING"] as const;
export type ConversionContext = (typeof CONVERSION_CONTEXTS)[number];
export const PAGE_LOAD_CATEGORIES = ["FAST", "AVERAGE", "SLOW", "UNKNOWN"] as const;
export type PageLoadCategory = (typeof PAGE_LOAD_CATEGORIES)[number];
/** Analytics collection mode derived from the existing consent framework. */
export const ANALYTICS_CONSENT_MODES = ["ENABLED", "DISABLED", "UNKNOWN", "WITHDRAWN"] as const;
export type AnalyticsConsentMode = (typeof ANALYTICS_CONSENT_MODES)[number];

export const ANALYTICS_LIMITS = {
  maxPathLen: 512,
  maxSegments: 24,
  maxCampaignLen: 64,
  maxCountryLen: 2,
  maxLanguageLen: 8,
  maxHashLen: 64,
  maxBatch: 20,
  maxBodyBytes: 16 * 1024,
} as const;

// ── Prohibited fields (defense in depth: an event may carry NONE of these, at any depth) ──
export const ANALYTICS_PROHIBITED_KEYS: readonly string[] = [
  "ip", "ipaddress", "remoteaddr", "xforwardedfor", "useragent", "ua", "rawreferrer", "referrerurl",
  "querystring", "query", "url", "fullurl", "href", "email", "name", "firstname", "lastname", "phone",
  "phonenumber", "address", "latitude", "longitude", "geo", "coordinates", "city", "postal", "postalcode",
  "zip", "asn", "isp", "fingerprint", "canvas", "webgl", "fonts", "screen", "resolution", "hardwareconcurrency",
  "battery", "plugins", "cookie", "cookies", "token", "jwt", "accesstoken", "refreshtoken", "sessiontoken",
  "sessionid", "password", "secret", "credential", "apikey", "message", "messagetext", "content", "body",
  "formdata", "form", "field", "childname", "guardian", "guardianemail", "incident", "signal", "adid",
  "advertisingid", "gclid", "fbclid", "clickid", "dom", "html", "keystroke", "mouse", "metadata", "payload",
];
const PROHIBITED_SET = new Set(ANALYTICS_PROHIBITED_KEYS);
/** Recursively assert no prohibited key appears anywhere (raw-content / PII / fingerprint / secret guard). */
export function analyticsContainsProhibitedKey(obj: unknown, depth = 0): string | null {
  if (depth > 5 || obj === null || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PROHIBITED_SET.has(k.toLowerCase())) return k;
    const nested = analyticsContainsProhibitedKey(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

// ── Path normalization (strict; strips query/hash + collapses per-entity identifiers) ──
const ID_SEGMENT = /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|[A-Fa-f0-9]{16,}|[A-Za-z0-9_-]{32,})$/;
/**
 * Normalize a page path for storage: keep the pathname only (drop query + fragment), lowercase, collapse
 * per-entity id / email / token / uuid / long-opaque segments to `:id`, bound the length + segment count.
 * Returns null for an unacceptable (excessively long / non-string) path so the caller can reject it.
 */
export function normalizeAnalyticsPath(pathOrUrl: unknown): string | null {
  if (typeof pathOrUrl !== "string" || pathOrUrl.length === 0 || pathOrUrl.length > ANALYTICS_LIMITS.maxPathLen) return null;
  let path = pathOrUrl.split("#")[0]!.split("?")[0]!;
  if (!path.startsWith("/")) path = `/${path}`;
  const segs = path.split("/");
  if (segs.length > ANALYTICS_LIMITS.maxSegments) return null;
  const normalized = segs.map((seg) => (seg && ID_SEGMENT.test(seg) ? ":id" : seg.toLowerCase())).join("/");
  const out = normalized === "" ? "/" : normalized;
  // Final guard: nothing that still looks like an email / token survived.
  return /[@]|[A-Za-z0-9_-]{32,}/.test(out) ? "/:id" : out;
}

/** Strict campaign-value sanitization: bounded, allow-listed characters only (never arbitrary query data). */
export function sanitizeCampaignValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (t.length === 0 || t.length > ANALYTICS_LIMITS.maxCampaignLen) return null;
  if (!/^[a-z0-9._-]+$/.test(t)) return null; // no spaces, no arbitrary chars, no click-id shapes with delimiters
  return t;
}

/** Two-letter uppercase country code, or "UNKNOWN". Never invents data. */
export function normalizeCountryCode(v: unknown): string {
  if (typeof v !== "string") return "UNKNOWN";
  const t = v.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : "UNKNOWN";
}
/** Bounded BCP-47-ish primary language subtag, or "und" (undetermined). */
export function normalizeLanguage(v: unknown): string {
  if (typeof v !== "string") return "und";
  const t = v.trim().toLowerCase().split(",")[0]!.split("-")[0]!;
  return /^[a-z]{2,3}$/.test(t) ? t : "und";
}

// ── User-agent classification (server-side; the UA string itself is NEVER stored) ──
export function classifyBotFromUA(ua: string | null | undefined): BotClassification {
  if (!ua) return "SUSPECTED_BOT"; // a missing UA on a browser request is bot-like
  const s = ua.toLowerCase();
  if (/bot|crawl|spider|slurp|bingpreview|headless|python-requests|curl|wget|axios|go-http|java\/|phantomjs|puppeteer|playwright|lighthouse|scrapy|semrush|ahrefs|facebookexternalhit|googlebot|bingbot|yandex|duckduck/.test(s)) return "KNOWN_BOT";
  if (!/mozilla|applewebkit|gecko|trident/.test(s)) return "SUSPECTED_BOT";
  return "HUMAN_LIKELY";
}
export function classifyDeviceFromUA(ua: string | null | undefined, bot?: BotClassification): DeviceCategory {
  if ((bot ?? classifyBotFromUA(ua)) === "KNOWN_BOT") return "BOT";
  if (!ua) return "UNKNOWN";
  const s = ua.toLowerCase();
  if (/ipad|tablet|kindle|playbook|nexus 7|nexus 10|sm-t/.test(s)) return "TABLET";
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/.test(s)) return "MOBILE";
  if (/android/.test(s)) return "TABLET"; // Android without "mobile" → tablet heuristic
  if (/windows|macintosh|mac os x|linux|cros/.test(s)) return "DESKTOP";
  return "UNKNOWN";
}
export function classifyBrowserFromUA(ua: string | null | undefined): BrowserFamily {
  if (!ua) return "Unknown";
  const s = ua.toLowerCase();
  if (/edg\//.test(s)) return "Edge";
  if (/firefox|fxios/.test(s)) return "Firefox";
  if (/chrome|crios|chromium/.test(s) && !/edg\//.test(s)) return "Chrome";
  if (/safari/.test(s) && !/chrome|crios|chromium/.test(s)) return "Safari";
  return "Other";
}
export function classifyOSFromUA(ua: string | null | undefined): OsFamily {
  if (!ua) return "Unknown";
  const s = ua.toLowerCase();
  if (/iphone|ipad|ipod|ios/.test(s)) return "iOS";
  if (/android/.test(s)) return "Android";
  if (/mac os x|macintosh/.test(s)) return "macOS";
  if (/windows/.test(s)) return "Windows";
  if (/linux|cros|x11/.test(s)) return "Linux";
  return "Other";
}

/** Categorize a referrer from a validated hostname (public-suffix-agnostic broad buckets). Never stores the host. */
export function categorizeReferrerHost(host: string | null | undefined, ownHosts: readonly string[] = []): ReferrerCategory {
  if (!host) return "DIRECT";
  const h = host.trim().toLowerCase().replace(/^www\./, "");
  if (!h) return "DIRECT";
  if (ownHosts.some((o) => h === o || h.endsWith(`.${o}`))) return "INTERNAL";
  if (/(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex|startpage|brave)\./.test(h)) return "ORGANIC_SEARCH";
  if (/(facebook|instagram|twitter|t\.co|x\.com|linkedin|reddit|youtube|tiktok|pinterest|threads)\./.test(h)) return "SOCIAL";
  if (/(mail\.|gmail|outlook|proton|yahoo\.mail|list-manage|mailchimp|sendgrid)\./.test(h)) return "EMAIL";
  return "REFERRAL";
}

// ── Strict ingestion-event validation (used by POST /api/analytics/events) ──
export interface IngestEventInput {
  eventType: string;
  path?: unknown;
  referrerCategory?: unknown;
  referrerHost?: unknown; // server validates → category only; never stored raw
  campaignSource?: unknown;
  campaignMedium?: unknown;
  campaignName?: unknown;
  language?: unknown;
  pageLoadCategory?: unknown;
  ctaId?: unknown; // bounded label for CTA_CLICK
  occurredAt?: unknown;
}
export interface IngestValidationResult { valid: boolean; errors: string[]; }
const CTA_RE = /^[a-z0-9_.-]{1,48}$/;
export function validateIngestEvent(raw: unknown): IngestValidationResult {
  const errors: string[] = [];
  const err = (c: string) => { if (errors.length < 30) errors.push(c); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { valid: false, errors: ["not_an_object"] };
  const e = raw as Record<string, unknown>;
  const prohibited = analyticsContainsProhibitedKey(e);
  if (prohibited) err(`prohibited_field:${prohibited}`);
  const allowed = ["eventType", "path", "referrerCategory", "referrerHost", "campaignSource", "campaignMedium", "campaignName", "language", "pageLoadCategory", "ctaId", "occurredAt"];
  for (const k of Object.keys(e)) if (!allowed.includes(k)) err(`unknown_key:${k}`);
  if (!isAnalyticsEventType(e.eventType)) err("bad_eventType");
  // A client may NEVER submit a conversion event (those are server-recorded from domain actions).
  if (typeof e.eventType === "string" && isConversionEvent(e.eventType)) err("conversion_not_client_submittable");
  if (e.path !== undefined && normalizeAnalyticsPath(e.path) === null) err("bad_path");
  if (e.referrerCategory !== undefined && !(REFERRER_CATEGORIES as readonly string[]).includes(e.referrerCategory as string)) err("bad_referrerCategory");
  if (e.referrerHost !== undefined && (typeof e.referrerHost !== "string" || e.referrerHost.length > 253)) err("bad_referrerHost");
  for (const f of ["campaignSource", "campaignMedium", "campaignName"] as const) if (e[f] !== undefined && sanitizeCampaignValue(e[f]) === null) err(`bad_${f}`);
  if (e.pageLoadCategory !== undefined && !(PAGE_LOAD_CATEGORIES as readonly string[]).includes(e.pageLoadCategory as string)) err("bad_pageLoadCategory");
  if (e.ctaId !== undefined && (typeof e.ctaId !== "string" || !CTA_RE.test(e.ctaId))) err("bad_ctaId");
  return { valid: errors.length === 0, errors };
}

// ── Aggregate dimensions + measures (the analytics warehouse shape) ──
export const AGGREGATE_DIMENSIONS = ["date", "path", "eventType", "referrerCategory", "campaignSource", "deviceCategory", "browserFamily", "operatingSystemFamily", "countryCode", "language", "authenticatedUserState", "botClassification"] as const;
export type AggregateDimension = (typeof AGGREGATE_DIMENSIONS)[number];
export const AGGREGATE_MEASURES = ["pageViews", "sessions", "approximateUniqueVisitors", "conversions", "bounces", "engagedSessions", "errorPageViews"] as const;
export type AggregateMeasure = (typeof AGGREGATE_MEASURES)[number];
/** Group-by dimensions the admin API allows (no arbitrary SQL dimension). */
export const ALLOWED_GROUP_BY: readonly AggregateDimension[] = ["path", "eventType", "referrerCategory", "campaignSource", "deviceCategory", "browserFamily", "operatingSystemFamily", "countryCode", "language", "authenticatedUserState", "botClassification"];
export const isAllowedGroupBy = (v: string): v is AggregateDimension => (ALLOWED_GROUP_BY as readonly string[]).includes(v);

/** Low-count suppression threshold for UI groups (never reveals tiny cells). Not a defensive secret. */
export const LOW_COUNT_SUPPRESSION = 5;
export function suppressLowCount<T extends { count: number }>(rows: T[], threshold = LOW_COUNT_SUPPRESSION): { visible: T[]; suppressedGroups: number; suppressedCount: number } {
  const visible = rows.filter((r) => r.count >= threshold);
  const hidden = rows.filter((r) => r.count < threshold);
  return { visible, suppressedGroups: hidden.length, suppressedCount: hidden.reduce((a, r) => a + r.count, 0) };
}

/** Deterministic engaged-session definition (documented in analytics-metrics.md). */
export const ENGAGED_SESSION_MIN_EVENTS = 2;
/** Session inactivity window (ms) after which a session is considered ended. */
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;
/** Visitor pseudonym rotation window (monthly): part of the HMAC salt so ids are non-reversible + rotating. */
export const VISITOR_ROTATION = "monthly" as const;

export function bounceRate(sessions: number, bounces: number): number {
  return sessions <= 0 ? 0 : Math.round((bounces / sessions) * 1000) / 10;
}
export function conversionRate(sessions: number, conversions: number): number {
  return sessions <= 0 ? 0 : Math.round((conversions / sessions) * 1000) / 10;
}
