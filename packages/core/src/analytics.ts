/**
 * V1.53 / V1.53A — analytics domain: the SINGLE source of truth for product analytics events. Pure
 * and dependency-free (no browser APIs) so it is shared by the client runtime and any server code.
 *
 * V1.53A: event names are canonical successful-state names; ambiguous/obsolete names were removed
 * (`book_demo`, `login`, `logout`, `password_reset`, `checkout_completed`, `subscription_started`,
 * `instagram_connected`, `comment_replied`, `bulk_action_used`, `approval_completed`). Success events
 * are delivered server→client via a one-time redirect marker (see the web `AnalyticsMarker`), never by
 * calling gtag/fbq from the server and never from a raw button click.
 *
 * PRIVACY (hard rule): analytics may carry ONLY anonymous, low-cardinality context. Personal data,
 * secrets, and identifiers are NEVER sent — {@link sanitizeAnalyticsParams} strips forbidden keys and
 * PII/secret-shaped values, and {@link sanitizePagePath} strips query strings + tokenized segments
 * from page paths, before anything leaves the browser.
 */

/** The canonical catalogue of product events. Each name is an explicit, real product state. */
export type AnalyticsEventName =
  // Authentication
  | "registration_started" | "registration_completed" | "login_completed" | "logout_completed"
  | "email_verified" | "password_reset_completed"
  // Onboarding
  | "workspace_created" | "onboarding_completed"
  // Meta connector
  | "meta_connect_started" | "meta_connect_completed" | "facebook_page_connected" | "instagram_business_connected"
  // Billing
  | "checkout_started" | "subscription_activated" | "subscription_upgraded" | "subscription_cancelled"
  // Product
  | "dashboard_opened" | "comment_reviewed" | "moderation_action_completed" | "bulk_action_completed"
  // Marketing
  | "pricing_viewed" | "contact_form_sent";

/** Every event, at runtime — for validation, docs, and iteration. */
export const ANALYTICS_EVENTS: readonly AnalyticsEventName[] = [
  "registration_started", "registration_completed", "login_completed", "logout_completed",
  "email_verified", "password_reset_completed",
  "workspace_created", "onboarding_completed",
  "meta_connect_started", "meta_connect_completed", "facebook_page_connected", "instagram_business_connected",
  "checkout_started", "subscription_activated", "subscription_upgraded", "subscription_cancelled",
  "dashboard_opened", "comment_reviewed", "moderation_action_completed", "bulk_action_completed",
  "pricing_viewed", "contact_form_sent",
] as const;

/** Type guard for an untrusted string (e.g. a redirect marker value). */
export function isAnalyticsEvent(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && (ANALYTICS_EVENTS as readonly string[]).includes(value);
}

export type AnalyticsParamValue = string | number | boolean;
export type AnalyticsParams = Record<string, AnalyticsParamValue>;

/**
 * Consent Mode v2 signals. Everything defaults to "denied"; tracking begins only after consent.
 * `analytics_storage` gates GA4; the three `ad_*` signals gate the Meta Pixel + Google Ads.
 */
export type ConsentSignal = "granted" | "denied";
export interface ConsentState {
  analytics_storage: ConsentSignal;
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
}
export const CONSENT_DEFAULT_DENIED: ConsentState = {
  analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
};
export const CONSENT_GRANTED: ConsentState = {
  analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted",
};

/**
 * Map our neutral event names to Meta Pixel STANDARD events ONLY where the mapping is semantically
 * truthful. Unmapped events are sent as custom events. No misleading standard-event claims.
 */
export const META_PIXEL_STANDARD_EVENTS: Partial<Record<AnalyticsEventName, string>> = {
  registration_completed: "CompleteRegistration",
  contact_form_sent: "Lead",
  checkout_started: "InitiateCheckout",
  subscription_activated: "Subscribe",
};

// ---------------------------------------------------------------------------
// Privacy filter — the last line of defense before an event leaves the browser.
// ---------------------------------------------------------------------------

/** Param KEYS that must never appear on an analytics event (substring match, case-insensitive). */
const FORBIDDEN_KEY_PARTS = [
  "email", "token", "jwt", "cookie", "auth", "password", "secret", "session",
  "tenant", "user", "member", "workspace", "brand", "page", "instagram", "stripe", "customer",
  "account_id", "comment", "message", "content", "text", "body", "code", "state",
  "ip", "phone", "address", "name", "refresh", "access", "bearer", "credential", "key",
];
/** VALUE shapes that indicate PII / a secret leaked into a value. */
const FORBIDDEN_VALUE = /(@[a-z0-9.-]+\.[a-z]{2,}|bearer\s|eyj[a-z0-9._-]+|postgres(?:ql)?:\/\/|sk_(live|test)_|cus_[a-z0-9]|sub_[a-z0-9]|price_[a-z0-9]|[a-f0-9]{32,})/i;
const MAX_VALUE_LEN = 64;

/**
 * Strip anything unsafe from analytics params: forbidden keys, non-primitive values, PII/secret-
 * shaped strings, and over-long strings. Returns only safe, low-cardinality labels.
 */
export function sanitizeAnalyticsParams(params?: AnalyticsParams): AnalyticsParams {
  const out: AnalyticsParams = {};
  if (!params) return out;
  for (const [rawKey, value] of Object.entries(params)) {
    const key = rawKey.toLowerCase();
    if (!/^[a-z0-9_]{1,40}$/.test(key)) continue;
    if (FORBIDDEN_KEY_PARTS.some((p) => key.includes(p))) continue;
    if (typeof value === "number") { if (Number.isFinite(value)) out[key] = value; continue; }
    if (typeof value === "boolean") { out[key] = value; continue; }
    if (typeof value === "string") {
      const v = value.trim();
      if (v.length === 0 || v.length > MAX_VALUE_LEN || FORBIDDEN_VALUE.test(v)) continue;
      out[key] = v;
    }
  }
  return out;
}

/** Route segments that carry a per-entity id — normalized to a placeholder so no id is ever sent. */
const ID_SEGMENT = /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{6,})$/i;
/** Paths whose query string is known to carry a token/secret — the query is always dropped anyway. */

/**
 * Normalize a page path for analytics: DROP the query string entirely (so `?token=…`, `?code=…`,
 * `?ae=…`, `?checkout=…` and any error params never reach a provider) and replace per-entity id
 * segments with `:id`. Only clean, normalized route information is ever sent as `page_path`.
 */
export function sanitizePagePath(pathOrUrl: string): string {
  // Keep only the pathname (drop query + hash).
  let path = pathOrUrl.split("#")[0]!.split("?")[0]!;
  if (!path.startsWith("/")) path = `/${path}`;
  const normalized = path
    .split("/")
    .map((seg) => (seg && ID_SEGMENT.test(seg) ? ":id" : seg))
    .join("/");
  return normalized === "" ? "/" : normalized;
}
