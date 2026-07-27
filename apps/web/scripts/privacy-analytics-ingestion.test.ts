/**
 * Platform Privacy Analytics V1 — ingestion HTTP-surface tests (local DB). Exercises the import-safe ingestion
 * core: same-origin enforcement, content-type/body-size limits, batch cap, rate limiting, consent-aware
 * collection + cookie lifecycle, prohibited-field rejection, and the SAFE generic response. Privacy invariants
 * (no raw IP/UA/query/referrer persisted) are proven at the service layer; here we prove the boundary.
 * Run: pnpm privacy-analytics-ingestion:test
 */
import { systemDb } from "@guardora/db";
import { handleAnalyticsIngest, consentModeFrom, __resetIngestRateLimiter, ANALYTICS_VISITOR_COOKIE, ANALYTICS_SESSION_COOKIE } from "../src/server/analytics/ingest-core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const DAY = new Date(Date.UTC(2003, 0, 1 + (process.pid % 3000)));
const iso = DAY.toISOString();
const P = `/t${process.pid}/ingest`;
const base = () => ({ sameOrigin: true as boolean, contentType: "application/json" as string | null, userAgent: "Mozilla/5.0 Chrome/120 Safari/537.36", ip: "203.0.113.5", visitorToken: "vt", sessionToken: "st", consent: "ENABLED" as const, authenticatedUserState: "ANONYMOUS" as const, tenantState: "NONE" as const, ownHosts: ["localhost"], now: DAY });
const body = (evs: unknown[]) => JSON.stringify({ events: evs });

async function stored() { return systemDb.websiteAnalyticsEvent.count({ where: { occurredAt: DAY, normalizedPath: { startsWith: P } } }); }

async function main() {
  await systemDb.websiteAnalyticsEvent.deleteMany({ where: { occurredAt: DAY } }).catch(() => {});
  __resetIngestRateLimiter();

  console.log("\n1. same-origin + content-type + size");
  check("★ valid same-origin JSON event accepted (200) + stored", (await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, occurredAt: iso }]), base())).status === 200 && (await stored()) === 1);
  check("★ FOREIGN origin rejected (403), nothing stored", (await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: `${P}x`, occurredAt: iso }]), { ...base(), sameOrigin: false })).status === 403 && (await systemDb.websiteAnalyticsEvent.count({ where: { normalizedPath: `${P}x` } })) === 0);
  check("★ wrong content-type rejected (415)", (await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P }]), { ...base(), contentType: "multipart/form-data" })).status === 415);
  check("★ oversized body rejected (413)", (await handleAnalyticsIngest("x".repeat(20000), base())).status === 413);
  check("★ text/plain (sendBeacon) content-type accepted", (await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, occurredAt: iso }]), { ...base(), contentType: "text/plain;charset=UTF-8" })).status === 200);

  console.log("\n2. strict schema + prohibited fields");
  const before = await stored();
  await handleAnalyticsIngest(body([{ eventType: "MADE_UP", path: P }]), base());
  await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, email: "a@b.com" }]), base());
  await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, nested: { token: "x" } }]), base());
  await handleAnalyticsIngest(body([{ eventType: "REGISTRATION_COMPLETED", path: P }]), base()); // conversion not client-submittable
  check("★ unknown event / prohibited key / nested secret / client-conversion all rejected (none stored)", (await stored()) === before);
  const over = Array.from({ length: 30 }, () => ({ eventType: "PAGE_VIEW", path: P }));
  check("★ batch over the cap is rejected", (await handleAnalyticsIngest(body(over), base())).status === 200 && (await stored()) === before);

  console.log("\n3. consent + cookies");
  const noTokens = { ...base(), visitorToken: null, sessionToken: null };
  const granted = await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, occurredAt: iso }]), noTokens);
  check("★ consent ENABLED without tokens issues first-party visitor + session cookies", granted.setCookies.some((c) => c.name === ANALYTICS_VISITOR_COOKIE && c.value) && granted.setCookies.some((c) => c.name === ANALYTICS_SESSION_COOKIE));
  const denied = await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, occurredAt: iso }]), { ...noTokens, consent: "DISABLED" });
  check("★ consent DISABLED issues NO persistent identifier cookie", !denied.setCookies.some((c) => c.name === ANALYTICS_VISITOR_COOKIE && c.value));
  const withdrawn = await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, occurredAt: iso }]), { ...base(), consent: "WITHDRAWN" });
  check("★ consent WITHDRAWN expires existing analytics cookies (maxAge 0), no silent reactivation", withdrawn.setCookies.some((c) => c.name === ANALYTICS_VISITOR_COOKIE && c.maxAgeSec === 0));
  check("★ consentModeFrom maps granted/denied/withdrawn/unknown", consentModeFrom("granted") === "ENABLED" && consentModeFrom("denied") === "DISABLED" && consentModeFrom("withdrawn") === "WITHDRAWN" && consentModeFrom(null) === "UNKNOWN");

  console.log("\n4. rate limiting + safe response");
  __resetIngestRateLimiter();
  let limited = false;
  for (let i = 0; i < 80; i++) { const r = await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, occurredAt: iso }]), { ...base(), visitorToken: "flooder" }); if (r.status === 429) { limited = true; break; } }
  check("★ rate limiting kicks in for a flood (429)", limited);
  const shape = await handleAnalyticsIngest(body([{ eventType: "PAGE_VIEW", path: P, occurredAt: iso }]), { ...base(), sameOrigin: false });
  check("★ safe generic response body (no internals leaked; same { ok } shape on reject)", JSON.stringify(shape.body) === JSON.stringify({ ok: true }));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await systemDb.websiteAnalyticsEvent.deleteMany({ where: { occurredAt: DAY } }).catch(() => {});
    await systemDb.websiteAnalyticsEvent.deleteMany({ where: { normalizedPath: { startsWith: `/t${process.pid}` } } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Privacy Analytics Ingestion V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
