/**
 * V1.53A — analytics catalogue + privacy + URL-sanitization unit test (pure; no DB, no network).
 * Run via: pnpm analytics:test
 */
import {
  ANALYTICS_EVENTS, isAnalyticsEvent, META_PIXEL_STANDARD_EVENTS,
  sanitizeAnalyticsParams, sanitizePagePath, CONSENT_DEFAULT_DENIED,
  type AnalyticsEventName,
} from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const names = new Set<string>(ANALYTICS_EVENTS);

// --- catalogue: obsolete/ambiguous names removed, canonical names present ---
const REMOVED = ["book_demo", "login", "logout", "password_reset", "checkout_completed", "subscription_started", "instagram_connected", "comment_replied", "bulk_action_used", "approval_completed"];
for (const r of REMOVED) check(`removed event absent: ${r}`, !names.has(r));

const CANONICAL: AnalyticsEventName[] = [
  "registration_started", "registration_completed", "login_completed", "logout_completed", "email_verified",
  "password_reset_completed", "workspace_created", "onboarding_completed", "meta_connect_started",
  "meta_connect_completed", "facebook_page_connected", "instagram_business_connected", "checkout_started",
  "subscription_activated", "subscription_upgraded", "subscription_cancelled", "dashboard_opened",
  "comment_reviewed", "moderation_action_completed", "bulk_action_completed", "pricing_viewed", "contact_form_sent",
];
check("catalogue matches the 22 canonical events exactly", ANALYTICS_EVENTS.length === CANONICAL.length && CANONICAL.every((c) => names.has(c)), `${ANALYTICS_EVENTS.length}`);

// --- isAnalyticsEvent (the marker allowlist guard) ---
check("isAnalyticsEvent accepts a canonical name", isAnalyticsEvent("registration_completed"));
check("isAnalyticsEvent rejects a removed name", !isAnalyticsEvent("book_demo"));
check("isAnalyticsEvent rejects arbitrary/injection input", !isAnalyticsEvent("<script>") && !isAnalyticsEvent("") && !isAnalyticsEvent(123 as never));

// --- Meta mapping: only truthful standard events ---
check("Meta map: registration_completed → CompleteRegistration", META_PIXEL_STANDARD_EVENTS.registration_completed === "CompleteRegistration");
check("Meta map: contact_form_sent → Lead", META_PIXEL_STANDARD_EVENTS.contact_form_sent === "Lead");
check("Meta map: checkout_started → InitiateCheckout", META_PIXEL_STANDARD_EVENTS.checkout_started === "InitiateCheckout");
check("Meta map: subscription_activated → Subscribe", META_PIXEL_STANDARD_EVENTS.subscription_activated === "Subscribe");
check("Meta map: no misleading mappings (exactly 4, no meta_connect→Contact)", Object.keys(META_PIXEL_STANDARD_EVENTS).length === 4 && !("meta_connect_completed" in META_PIXEL_STANDARD_EVENTS));

// --- privacy filter ---
const dirty = sanitizeAnalyticsParams({
  plan: "growth", interval: "monthly", steps: 3, ok: true,          // safe → kept
  email: "a@b.com", userId: "u1", tenantId: "t1", brandId: "b1",     // forbidden keys → dropped
  pageId: "123", stripeId: "sub_1", token: "x", comment: "hi",       // forbidden keys → dropped
  note: "user@example.com", jwt: "eyJabc", cust: "cus_123",          // forbidden value/key → dropped
  huge: "x".repeat(200),                                             // too long → dropped
} as never);
check("privacy: safe labels kept", dirty.plan === "growth" && dirty.interval === "monthly" && dirty.steps === 3 && dirty.ok === true);
check("privacy: forbidden keys dropped", !("email" in dirty) && !("userId" in dirty) && !("tenantId" in dirty) && !("brandId" in dirty) && !("pageId" in dirty) && !("token" in dirty) && !("comment" in dirty));
check("privacy: PII/secret-shaped values dropped", !("note" in dirty) && !("jwt" in dirty) && !("cust" in dirty));
check("privacy: over-long values dropped", !("huge" in dirty));

// --- URL / page-path sanitization ---
check("path: verify token dropped", sanitizePagePath("/verify-email?token=SECRET123") === "/verify-email");
check("path: reset token dropped", sanitizePagePath("/reset-password?token=abc&x=1") === "/reset-password");
check("path: analytics marker dropped", sanitizePagePath("/login?reset=1&ae=email_verified") === "/login");
check("path: OAuth code/state dropped", sanitizePagePath("/api/auth/google/callback?code=X&state=Y") === "/api/auth/google/callback");
check("path: Stripe return + error params dropped", sanitizePagePath("/dashboard/billing?checkout=success&session_id=cs_1") === "/dashboard/billing");
check("path: entity id segment normalized", sanitizePagePath("/dashboard/accounts/cmabcdefghijklmnopqrstuvwx") === "/dashboard/accounts/:id");
check("path: hash dropped", sanitizePagePath("/#pricing") === "/");
check("path: plain route preserved", sanitizePagePath("/case-studies") === "/case-studies");

// --- consent default denied (privacy model intact) ---
check("consent defaults all denied", Object.values(CONSENT_DEFAULT_DENIED).every((v) => v === "denied"));

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — analytics catalogue, privacy & URL sanitization (V1.53A)`);
if (failures > 0) process.exit(1);
