/**
 * V1.53 — analytics domain: the SINGLE source of truth for product analytics events. Pure and
 * dependency-free (no browser APIs) so it is shared by the client runtime and any server code.
 *
 * PRIVACY (hard rule): analytics may carry ONLY anonymous, low-cardinality context. Personal data,
 * secrets, and identifiers are NEVER sent — {@link sanitizeAnalyticsParams} strips forbidden keys
 * and PII/secret-shaped values before any event leaves the browser. There is no user/tenant id in
 * any event; providers receive only the event name + a small set of safe labels.
 */

/** The canonical catalogue of product events. Adding an event here makes it type-safe everywhere. */
export type AnalyticsEventName =
  // Authentication
  | "registration_started" | "registration_completed" | "login" | "logout" | "password_reset"
  // Onboarding
  | "workspace_created" | "brand_created" | "team_member_added"
  // Meta connector
  | "meta_connect_started" | "meta_connect_completed" | "facebook_page_connected" | "instagram_connected"
  // Billing
  | "checkout_started" | "checkout_completed" | "subscription_started" | "subscription_upgraded" | "subscription_cancelled"
  // Product
  | "dashboard_opened" | "comment_reviewed" | "comment_replied" | "bulk_action_used" | "approval_completed"
  // Marketing
  | "contact_form_sent" | "book_demo" | "pricing_viewed";

/** Every event, at runtime — for validation, docs, and iteration. */
export const ANALYTICS_EVENTS: readonly AnalyticsEventName[] = [
  "registration_started", "registration_completed", "login", "logout", "password_reset",
  "workspace_created", "brand_created", "team_member_added",
  "meta_connect_started", "meta_connect_completed", "facebook_page_connected", "instagram_connected",
  "checkout_started", "checkout_completed", "subscription_started", "subscription_upgraded", "subscription_cancelled",
  "dashboard_opened", "comment_reviewed", "comment_replied", "bulk_action_used", "approval_completed",
  "contact_form_sent", "book_demo", "pricing_viewed",
] as const;

export type AnalyticsParamValue = string | number | boolean;
export type AnalyticsParams = Record<string, AnalyticsParamValue>;

/**
 * Consent Mode v2 signals. Everything defaults to "denied"; tracking begins only after the user
 * grants consent. Ad signals are wired but stay denied — no advertising is active yet.
 */
export type ConsentSignal = "granted" | "denied";
export interface ConsentState {
  analytics_storage: ConsentSignal;
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
}
export const CONSENT_DEFAULT_DENIED: ConsentState = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
};
export const CONSENT_GRANTED: ConsentState = {
  analytics_storage: "granted",
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
};

/**
 * Map our neutral event names to Meta Pixel STANDARD events where one applies (better ad-platform
 * signal quality later). Unmapped events are sent as custom events. No mapping carries PII.
 */
export const META_PIXEL_STANDARD_EVENTS: Partial<Record<AnalyticsEventName, string>> = {
  registration_completed: "CompleteRegistration",
  checkout_started: "InitiateCheckout",
  checkout_completed: "Purchase",
  subscription_started: "Subscribe",
  book_demo: "Lead",
  contact_form_sent: "Lead",
  meta_connect_completed: "Contact",
};

// ---------------------------------------------------------------------------
// Privacy filter — the last line of defense before an event leaves the browser.
// ---------------------------------------------------------------------------

/** Param KEYS that must never appear on an analytics event (substring match, case-insensitive). */
const FORBIDDEN_KEY_PARTS = [
  "email", "token", "jwt", "cookie", "auth", "password", "secret", "session",
  "tenant", "user", "member", "account_id", "comment", "message", "content", "text", "body",
  "ip", "phone", "address", "name", "refresh", "access", "bearer", "credential", "key",
];
/** VALUE shapes that indicate PII / a secret leaked into a value. */
const FORBIDDEN_VALUE = /(@[a-z0-9.-]+\.[a-z]{2,}|bearer\s|eyj[a-z0-9._-]+|postgres(?:ql)?:\/\/|sk_(live|test)_|[a-f0-9]{32,})/i;
const MAX_VALUE_LEN = 64;

/**
 * Strip anything unsafe from analytics params: forbidden keys, non-primitive values, PII/secret-
 * shaped strings, and over-long strings. Returns only safe, low-cardinality labels. This runs on
 * EVERY event so a careless call site can never exfiltrate personal data or a secret.
 */
export function sanitizeAnalyticsParams(params?: AnalyticsParams): AnalyticsParams {
  const out: AnalyticsParams = {};
  if (!params) return out;
  for (const [rawKey, value] of Object.entries(params)) {
    const key = rawKey.toLowerCase();
    if (!/^[a-z0-9_]{1,40}$/.test(key)) continue; // bounded, safe key shape only
    if (FORBIDDEN_KEY_PARTS.some((p) => key.includes(p))) continue;
    if (typeof value === "number") { if (Number.isFinite(value)) out[key] = value; continue; }
    if (typeof value === "boolean") { out[key] = value; continue; }
    if (typeof value === "string") {
      const v = value.trim();
      if (v.length === 0 || v.length > MAX_VALUE_LEN || FORBIDDEN_VALUE.test(v)) continue;
      out[key] = v;
    }
    // objects/arrays/functions are dropped entirely (never serialized into analytics)
  }
  return out;
}
