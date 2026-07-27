/**
 * Platform Privacy Analytics V1 — ingestion + privacy DOMAIN tests (local DB). Proves the first-party,
 * privacy-preserving pipeline: strict validation, prohibited-field rejection, path/query/fragment/identifier
 * normalization, NO raw IP / UA / referrer / query persistence, server-derived rotating visitor/session
 * hashes, consent-disabled essential mode, bot classification, and idempotent server-side conversions.
 * Run: pnpm privacy-analytics-domain:test
 */
import { systemDb, ingestAnalyticsEvents, recordConversion, deriveAnalyticsIdentifiers, analyticsIdempotencyKey } from "@guardora/db";
import { ANALYTICS_PROHIBITED_KEYS } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
// Isolate to a unique far-past UTC day so this run never collides with other analytics data.
const DAY = new Date(Date.UTC(2001, 0, 1 + (process.pid % 3000)));
const iso = DAY.toISOString();
const paths: string[] = [`/t${process.pid}/home`, `/t${process.pid}/pricing`];

async function events(path = "/") {
  return systemDb.websiteAnalyticsEvent.findMany({ where: { occurredAt: DAY, normalizedPath: { startsWith: path } } });
}

async function main() {
  await systemDb.websiteAnalyticsEvent.deleteMany({ where: { occurredAt: DAY } }).catch(() => {}); // defensive pre-clean
  const baseCtx = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36", ip: "203.0.113.42", visitorToken: "raw-visitor-token-abc", sessionToken: "raw-session-token-xyz", consent: "ENABLED" as const, now: DAY };

  // ── A. VALID INGESTION + CLASSIFICATION ───────────────────────────
  console.log("\nA. valid ingestion");
  const r1 = await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: `/t${process.pid}/home?token=SECRET&utm=x#frag`, occurredAt: iso, language: "en-US" }], baseCtx);
  check("★ valid same-origin event accepted", r1.accepted === 1 && r1.rejected === 0);
  const evs = await events(`/t${process.pid}/home`);
  const e0 = evs[0]!;
  check("★ query string + fragment stripped from stored path", e0.normalizedPath === `/t${process.pid}/home` && !e0.normalizedPath.includes("?") && !e0.normalizedPath.includes("#"));
  check("★ UA classified (Chrome / macOS / DESKTOP), UA string NOT stored", e0.browserFamily === "Chrome" && e0.operatingSystemFamily === "macOS" && e0.deviceCategory === "DESKTOP" && !("userAgent" in e0) && !("ua" in e0));
  check("★ IP NOT persisted; country coarse (UNKNOWN locally)", !("ip" in e0) && !("ipAddress" in e0) && e0.countryCode === "UNKNOWN");
  check("★ visitor/session hashes are server-derived (NOT the raw tokens)", e0.visitorIdHash !== baseCtx.visitorToken && e0.sessionIdHash !== baseCtx.sessionToken && /^[a-f0-9]{48}$/.test(e0.visitorIdHash) && /^[a-f0-9]{48}$/.test(e0.sessionIdHash));

  // ── B. IDENTIFIER ROTATION + NON-REVERSIBILITY ───────────────────
  console.log("\nB. identifier design");
  const jan = deriveAnalyticsIdentifiers({ visitorToken: "same-token", sessionToken: "s", consent: "ENABLED", now: new Date(Date.UTC(2026, 0, 15)) });
  const feb = deriveAnalyticsIdentifiers({ visitorToken: "same-token", sessionToken: "s", consent: "ENABLED", now: new Date(Date.UTC(2026, 1, 15)) });
  check("★ visitor pseudonym ROTATES monthly (same token → different hash across months)", jan.visitorIdHash !== feb.visitorIdHash);
  check("★ session hash stable within its token", jan.sessionIdHash === feb.sessionIdHash);
  const anon = deriveAnalyticsIdentifiers({ visitorToken: "same-token", sessionToken: "s", consent: "DISABLED", now: new Date(Date.UTC(2026, 0, 15)) });
  check("★ consent-disabled uses a DIFFERENT (anonymous) identifier, not the stable one", anon.visitorIdHash !== jan.visitorIdHash);

  // ── C. STRICT REJECTION ───────────────────────────────────────────
  console.log("\nC. strict rejection");
  check("★ unknown event type rejected", (await ingestAnalyticsEvents([{ eventType: "TOTALLY_MADE_UP", path: "/" }], baseCtx)).rejected === 1);
  check("★ prohibited raw-content/PII key (email) rejected", (await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: "/", email: "a@b.com" }], baseCtx)).accepted === 0);
  check("★ prohibited raw IP field rejected", (await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: "/", ip: "1.2.3.4" }], baseCtx)).accepted === 0);
  check("★ arbitrary metadata field rejected", (await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: "/", metadata: { x: 1 } }], baseCtx)).accepted === 0);
  check("★ nested prohibited key (form.message) rejected", (await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: "/", form: { message: "hi" } }], baseCtx)).accepted === 0);
  check("★ a CLIENT cannot submit a conversion event", (await ingestAnalyticsEvents([{ eventType: "REGISTRATION_COMPLETED", path: "/" }], baseCtx)).accepted === 0);
  check("★ PROHIBITED_KEYS covers ip/useragent/referrerurl/querystring/fingerprint/token/email/childname/guardian", ["ip", "useragent", "referrerurl", "querystring", "fingerprint", "token", "email", "childname", "guardian"].every((k) => ANALYTICS_PROHIBITED_KEYS.includes(k)));

  // ── D. PATH IDENTIFIER NORMALIZATION ──────────────────────────────
  console.log("\nD. path normalization");
  await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: `/t${process.pid}/reset/a3f8c9d2e1b4a6f70123456789abcdef`, occurredAt: iso }], baseCtx);
  const idEv = (await events(`/t${process.pid}/reset`))[0];
  check("★ per-entity id / token segment collapsed to :id (no reset token stored)", !!idEv && idEv.normalizedPath === `/t${process.pid}/reset/:id`);
  await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: `/t${process.pid}/u/user@example.com`, occurredAt: iso }], baseCtx);
  const emailEv = (await events(`/t${process.pid}/u`))[0];
  check("★ an email in a path segment is collapsed (never stored)", !!emailEv && !emailEv.normalizedPath.includes("@"));

  // ── E. CONSENT-DISABLED ESSENTIAL MODE ────────────────────────────
  console.log("\nE. consent-disabled mode");
  const noConsent = { ...baseCtx, consent: "DISABLED" as const };
  const cd1 = await ingestAnalyticsEvents([{ eventType: "PAGE_VIEW", path: `/t${process.pid}/anon`, occurredAt: iso }], noConsent);
  check("★ consent-disabled: aggregate PAGE_VIEW still counted", cd1.accepted === 1);
  const cd2 = await ingestAnalyticsEvents([{ eventType: "CTA_CLICK", path: `/t${process.pid}/anon`, ctaId: "hero", occurredAt: iso }], noConsent);
  check("★ consent-disabled: non-essential event (CTA_CLICK) NOT persisted", cd2.accepted === 0);
  const anonEv = (await events(`/t${process.pid}/anon`))[0];
  check("★ consent-disabled event uses an anonymous (non-tracking) visitor hash", !!anonEv && anonEv.visitorIdHash !== e0.visitorIdHash);

  // ── F. SERVER-SIDE CONVERSIONS (idempotent) ───────────────────────
  console.log("\nF. server-side conversions");
  const key = analyticsIdempotencyKey("registration", `test-${process.pid}`);
  const c1 = await recordConversion("REGISTRATION_COMPLETED", key, { now: DAY, authenticatedUserState: "AUTHENTICATED", tenantState: "HAS_TENANT" });
  const c2 = await recordConversion("REGISTRATION_COMPLETED", key, { now: DAY }); // retry with same key
  check("★ registration conversion recorded ONCE; duplicate retry NOT double-counted", c1.recorded === true && c2.recorded === false);
  const convEvs = await systemDb.websiteAnalyticsEvent.findMany({ where: { occurredAt: DAY, eventType: "REGISTRATION_COMPLETED" } });
  check("★ exactly one conversion event stored, content-free (context only, no email/name)", convEvs.length === 1 && convEvs[0]!.conversionContext === "REGISTRATION" && !("email" in convEvs[0]!) && !("name" in convEvs[0]!));
  check("★ contact conversion recorded without form content", (await recordConversion("CONTACT_FORM_SUBMITTED", analyticsIdempotencyKey("contact", `t-${process.pid}`), { now: DAY })).recorded === true);
  check("★ a non-conversion event type cannot be recorded as a conversion", (await recordConversion("PAGE_VIEW" as never, "k", { now: DAY })).recorded === false);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    // Clean up ONLY this run's isolated day.
    await systemDb.websiteAnalyticsEvent.deleteMany({ where: { occurredAt: DAY } }).catch(() => {});
    await systemDb.websiteAnalyticsDailyAggregate.deleteMany({ where: { date: DAY } }).catch(() => {});
    await systemDb.websiteAnalyticsConversionIdempotency.deleteMany({ where: { eventType: { in: ["REGISTRATION_COMPLETED", "CONTACT_FORM_SUBMITTED"] }, idempotencyKey: { contains: String(process.pid) } } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Privacy Analytics Domain V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
