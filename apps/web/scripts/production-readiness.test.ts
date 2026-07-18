/**
 * V1.39 — production-readiness guardrails.
 *
 * Behavior checks against the real libs (safe errors, ops redaction, connector display
 * truthfulness) + source/route guardrails for boundaries, fail-closed readiness, demo/mock
 * production gating, and dead-UI/secret scans. No new product feature is asserted.
 *
 * Run: pnpm production-readiness:test
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { SAFE_ERRORS, toSafeError, newCorrelationId } from "../src/lib/errors";
import { redact } from "../src/lib/ops-events";
import { connectorDisplay } from "../src/lib/connector-display";
import { PROVIDERS, providerStatusFor } from "../src/lib/provider-status";
import { resolveStripePriceId, planForStripePriceId, stripeBillingReadiness, evaluateCheckoutGuard, stripePriceAvailability, stripePriceKeyFor, type BillingPlanId, type BillingInterval } from "@guardora/core";
import { resolveBillingCta } from "../src/app/dashboard/billing/cta";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const WEB = resolve(process.cwd(), "../web");
const src = (p: string) => readFileSync(join(WEB, p), "utf8");
const has = (p: string) => existsSync(join(WEB, p));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|)$/.test(name) && (name.endsWith(".tsx") || name.endsWith(".ts"))) out.push(full);
  }
  return out;
}

function run() {
  // ---------------- safe error model ----------------
  const reasons = Object.keys(SAFE_ERRORS);
  check("1) every safe error has title + message + remediation", reasons.length >= 14 && reasons.every((r) => { const e = SAFE_ERRORS[r as keyof typeof SAFE_ERRORS]; return e.title && e.message && e.remediation; }));
  const allText = reasons.map((r) => JSON.stringify(SAFE_ERRORS[r as keyof typeof SAFE_ERRORS])).join(" ");
  check("2) safe errors leak no stack/DB/prisma/postgres", !/prisma|postgres|PrismaClient|at Object\.|\bstack\b|node_modules/i.test(allText));
  check("3) toSafeError round-trips reason", toSafeError("token_expired").reason === "token_expired" && toSafeError("permission_denied").title === SAFE_ERRORS.permission_denied.title);
  const id1 = newCorrelationId(), id2 = newCorrelationId();
  check("4) correlation id: prefixed, non-empty, no secret", id1.startsWith("t_") && id1.length >= 6 && id1 !== id2);

  // ---------------- ops redaction ----------------
  const red = redact({ token: "bearer abc.def", db: "postgresql://u:p@h/db", note: "ok", authorization: "Bearer x", count: 3 });
  check("5) ops redaction strips secret keys + secret-shaped values", red.token === "[redacted]" && red.authorization === "[redacted]" && red.db === "[redacted]" && red.note === "ok" && red.count === 3);

  // ---------------- connector display truthfulness ----------------
  const igConnected = connectorDisplay({ platformKey: "instagram", status: "active", health: "healthy", connectionStatus: "connected" });
  check("6) Instagram connected → verification_pending, NOT healthy/live", igConnected.state === "provider_verification_pending" && igConnected.tone === "warn" && /not live/i.test(igConnected.copy));
  const gbpConnected = connectorDisplay({ platformKey: "google_business", status: "active", health: "healthy", connectionStatus: "connected" });
  check("7) Google Business connected → verification_pending, NOT live", gbpConnected.state === "provider_verification_pending");
  const fbHealthy = connectorDisplay({ platformKey: "facebook", status: "active", health: "healthy", connectionStatus: "connected" });
  check("8) Facebook connected + healthy → healthy (ok)", fbHealthy.state === "healthy" && fbHealthy.tone === "ok");
  check("9) Facebook disconnected → disconnected + reconnect CTA", connectorDisplay({ platformKey: "facebook", status: "disconnected", health: "error" }).state === "disconnected" && connectorDisplay({ platformKey: "facebook", status: "disconnected" }).cta?.kind === "reconnect");
  check("10) Facebook token expired → token_expired", connectorDisplay({ platformKey: "facebook", status: "active", tokenHealth: "expired" }).state === "token_expired");
  check("11) Facebook missing permission → permission_missing", connectorDisplay({ platformKey: "facebook", status: "active", connectionStatus: "missing_permission" }).state === "permission_missing");
  check("12) YouTube/TikTok → unsupported (never connected)", connectorDisplay({ platformKey: "youtube", status: "active", health: "healthy" }).state === "unsupported" && connectorDisplay({ platformKey: "tiktok", status: "active" }).state === "unsupported");
  check("13) Facebook placeholder / sync-off → sync_disabled, NOT healthy", connectorDisplay({ platformKey: "facebook", status: "active", health: "healthy", mode: "placeholder" }).state === "sync_disabled" && connectorDisplay({ platformKey: "facebook", status: "active", health: "healthy" }, { liveSyncEnabled: false }).state === "sync_disabled");

  // ---------------- provider truth (one model) ----------------
  check("14) provider truth: Instagram/GBP not live; YT/LI/TT research", providerStatusFor("instagram")!.live === false && providerStatusFor("google_business")!.live === false && ["youtube", "linkedin", "tiktok"].every((k) => providerStatusFor(k)!.status === "research") && PROVIDERS.length === 6);

  // ---------------- error boundaries + loading ----------------
  // V1.56A — dashboard/loading.tsx was intentionally removed (it flashed a full-content skeleton on
  // every section navigation); continuity now comes from the persistent shell + retained content.
  // The dashboard error boundary and app-level boundaries remain required (see also check #30).
  check("15) boundaries present: not-found + global-error + dashboard error", has("src/app/not-found.tsx") && has("src/app/global-error.tsx") && has("src/app/dashboard/error.tsx"));
  check("16) error boundaries never render raw error.message", !/\{error\.message\}/.test(src("src/app/global-error.tsx")) && !/\{error\.message\}/.test(src("src/app/dashboard/error.tsx")) && /correlationId|digest/.test(src("src/app/global-error.tsx")));

  // ---------------- health / readiness ----------------
  check("17) health + readiness routes present", has("src/app/api/health/route.ts") && has("src/app/api/ready/route.ts"));
  const ready = src("src/app/api/ready/route.ts");
  check("18) readiness is fail-closed (503 when not ready) + uses safe checks", /503/.test(ready) && /validateRuntimeDbConfig/.test(ready) && /checkRlsRuntime/.test(ready) && /tokenStorageStatus/.test(ready));
  check("19) readiness never serializes DB URL / raw secret env", !/process\.env\.DATABASE_URL|process\.env\.APP_DATABASE_URL|process\.env\.TOKEN_ENCRYPTION_KEY/.test(ready));

  // ---------------- demo / mock production gating ----------------
  const login = src("src/app/login/page.tsx");
  check("20) login dev picker gated OFF in production (guard before the dev-user query)", /NODE_ENV !== "production"/.test(login) && /if \(!devLoginEnabled\)/.test(login) && login.indexOf("if (!devLoginEnabled)") < login.indexOf("await listDevLoginUsers"));
  check("21) dev sign-in action fail-closed in production", /devLoginEnabled = \(\) => process\.env\.NODE_ENV !== "production"/.test(src("src/server/session-actions.ts")));

  // ---------------- dead-UI + secret scans ----------------
  const files = walk(join(WEB, "src")).map((f) => ({ f, s: readFileSync(f, "utf8") }));
  const deadCta = files.filter(({ s }) => /href="#"/.test(s) || /\balert\(/.test(s));
  check("22) no dead CTAs (href=\"#\", alert())", deadCta.length === 0, deadCta.map((x) => x.f).join(", "));
  const logs = files.filter(({ f, s }) => !f.includes("/scripts/") && /console\.log\(/.test(s));
  check("23) no console.log in shipped components", logs.length === 0, logs.map((x) => x.f).join(", "));
  const stale = files.filter(({ s }) => /guardora\.ai/.test(s) && !/@guardora/.test(s.match(/.*guardora\.ai.*/)?.[0] ?? ""));
  check("24) no stale guardora.ai in web src", stale.length === 0, stale.map((x) => x.f).join(", "));

  // ---------------- native dependency packaging (V1.55B.2) ----------------
  // @node-rs/argon2 is required at runtime through the transpiled @guardora/db and is
  // externalized by next.config, so it is NOT bundled — Next output-file-tracing must
  // resolve it from node_modules. The DEPLOYED package (apps/web) must therefore own it
  // directly; otherwise Vercel's traced function omits the native module and every route
  // importing @guardora/db throws MODULE_NOT_FOUND at import time (500 on /api/ready, login,
  // registration). Declaring it on packages/db alone is insufficient for the app's trace.
  const webPkg = JSON.parse(src("package.json")) as { dependencies?: Record<string, string>; scripts?: Record<string, string> };
  check("25) apps/web declares @node-rs/argon2 as a direct runtime dependency (Vercel native packaging)", Boolean(webPkg.dependencies?.["@node-rs/argon2"]));

  // ---------------- Prisma native engine packaging (V1.55B.3) ----------------
  // The RHEL Query Engine must be generated for Vercel's serverless runtime, and the
  // deployed package (apps/web) must own @prisma/client so Next output-file-tracing
  // includes libquery_engine-rhel-openssl-3.0.x.so.node in every Prisma-using function.
  // Missing either -> PrismaClientInitializationError (engine not found) -> /api/ready,
  // login and registration fail at DB init in production.
  const prismaSchema = readFileSync(join(WEB, "../../packages/db/prisma/schema.prisma"), "utf8");
  check("26) prisma schema declares native + rhel-openssl-3.0.x binary targets (Vercel runtime engine)", /binaryTargets\s*=\s*\[[^\]]*["']rhel-openssl-3\.0\.x["'][^\]]*\]/.test(prismaSchema) && /["']native["']/.test(prismaSchema));
  check("27) apps/web owns @prisma/client + build runs prisma generate (engine generated & traced)", Boolean(webPkg.dependencies?.["@prisma/client"]) && /generate/.test(webPkg.scripts?.build ?? ""));

  // ---------------- dashboard latency guards (V1.56) ----------------
  // Root cause of the 3–5s dashboard was transatlantic compute↔DB latency: Vercel functions
  // defaulted to iad1 (US-East) while Supabase runs in eu-central-1 (Frankfurt) — ~180ms per
  // DB round-trip. Functions MUST be pinned to an EU region co-located with the database.
  const EU_REGIONS = ["fra1", "arn1", "cdg1"]; // Frankfurt / Stockholm / Paris — near eu-central-1
  let regionOk = false;
  try {
    const vj = JSON.parse(src("vercel.json")) as { regions?: string[] };
    regionOk = Array.isArray(vj.regions) && vj.regions.length > 0 && vj.regions.every((r) => EU_REGIONS.includes(r));
  } catch { regionOk = false; }
  check("28) Vercel functions pinned to an EU region co-located with Supabase eu-central-1 (fra1)", regionOk);
  // Dashboard critical data must load in parallel, never as sequential awaits, so transatlantic-
  // or in-region round-trips don't stack. Both the shell (layout) and the home page batch reads.
  const dashLayout = src("src/app/dashboard/layout.tsx");
  const dashPage = src("src/app/dashboard/page.tsx");
  check("29) dashboard shell + home load critical data in parallel (Promise.all, no sequential awaits)", /Promise\.all/.test(dashLayout) && /Promise\.all/.test(dashPage));

  // ---------------- dashboard navigation continuity (V1.56A) ----------------
  // A dashboard-root loading.tsx is used by Next.js as the Suspense fallback for EVERY
  // section navigation, flashing a full-content skeleton and resetting the content area on
  // each menu click. The persistent shell (layout) must stay mounted and content is retained
  // until the destination is ready — so there must be NO dashboard-root full-content fallback.
  check("30) no dashboard-root loading.tsx (no full-content skeleton flash on section navigation)", !existsSync(join(WEB, "src/app/dashboard/loading.tsx")));
  // Sidebar navigation must be client-side (next/link), not full-document reloads, so the shell
  // persists and only the destination content changes.
  const sidebar = src("src/components/dashboard/sidebar.tsx");
  check("31) dashboard sidebar navigates client-side via next/link (no full-document reloads)", /from ["']next\/link["']/.test(sidebar) && /<Link/.test(sidebar));

  // ---------------- no full-reload internal dashboard navigation (V1.56B) ----------------
  // Internal filtering/pagination must navigate client-side (next/link), preserving the
  // persistent shell — never a plain <a> that triggers a full-document reload. External links
  // (target=_blank), OAuth/API redirects and mailto are exempt (they intentionally leave the app).
  const commentsPage = src("src/app/dashboard/comments/page.tsx");
  check("32) comments filters/pagination navigate client-side (no full-reload <a href={params(...)}>)", !/<a\s[^>]*href=\{params\(/.test(commentsPage));
  const dashFiles = files.filter(({ f }) => f.includes("/app/dashboard/"));
  const hardNav = dashFiles.filter(({ s }) => /window\.location|location\.href|location\.assign|location\.replace/.test(s));
  check("33) no dashboard route navigates via window.location / location.href", hardNav.length === 0, hardNav.map((x) => x.f).join(", "));

  // ---------------- billing UX (V1.57) ----------------
  // Premium pricing: Growth highlighted with a "Most popular" badge, an expandable Compare Plans
  // table, real Upgrade CTAs (never a plain "checkout unavailable" text), and no added client JS.
  const billing = src("src/app/dashboard/billing/page.tsx");
  check("34) billing: Growth highlighted 'Most popular' + expandable Compare Plans + no dead 'unavailable' CTA text",
    /mostPopular/.test(billing) && /planId === "growth"/.test(billing) && /<details/.test(billing) && /COMPARE_ROWS/.test(billing) && !/notConfigured/.test(billing));
  check("35) billing page stays a server component (no added client-side hydration)", !/^["']use client["']/m.test(billing));

  // ---------------- paid-plan checkout routing (V1.57.1) ----------------
  // Starter/Growth/Agency must route to Stripe Checkout when configured and to a truthful
  // "checkout unavailable" state when not — NEVER to the generic /contact page. Only Enterprise
  // uses Contact Sales.
  const paidOwnerConfigured = resolveBillingCta({ isEnterprise: false, isCurrent: false, isOwner: true, canBuy: true });
  const paidOwnerUnconfigured = resolveBillingCta({ isEnterprise: false, isCurrent: false, isOwner: true, canBuy: false });
  const enterpriseOwner = resolveBillingCta({ isEnterprise: true, isCurrent: false, isOwner: true, canBuy: false });
  const paidNonOwner = resolveBillingCta({ isEnterprise: false, isCurrent: false, isOwner: false, canBuy: true });
  const currentPlan = resolveBillingCta({ isEnterprise: false, isCurrent: true, isOwner: true, canBuy: true });
  // No paid-plan owner/canBuy/current combination may ever resolve to contact_sales.
  const paidNeverContact = [true, false].every((cur) => [true, false].every((buy) => [true, false].every((own) =>
    resolveBillingCta({ isEnterprise: false, isCurrent: cur, isOwner: own, canBuy: buy }) !== "contact_sales")));
  check("36) paid CTA routing: configured→checkout, unconfigured→checkout_unavailable (never /contact); Enterprise→contact_sales",
    paidOwnerConfigured === "checkout" && paidOwnerUnconfigured === "checkout_unavailable" && enterpriseOwner === "contact_sales" &&
    paidNonOwner === "owner_only" && currentPlan === "current" && paidNeverContact);
  // Also: the billing page must not render a /contact upgrade CTA for paid plans (only the secondary
  // support link + the Enterprise Contact-sales button reference /contact).
  check("37) billing page has no paid-plan '/contact' upgrade route (only contact_sales + support link)",
    /resolveBillingCta/.test(billing) && !/upgradeTo\([^)]*\)}<\/Link>/.test(billing));
  // Price mapping: monthly/yearly pick the correct env var (not swapped); missing→null; enterprise→null.
  const mockEnv: Record<string, string> = {
    STRIPE_PRICE_STARTER_MONTHLY: "price_sm", STRIPE_PRICE_STARTER_YEARLY: "price_sy",
    STRIPE_PRICE_GROWTH_MONTHLY: "price_gm", STRIPE_PRICE_GROWTH_YEARLY: "price_gy",
    STRIPE_PRICE_AGENCY_MONTHLY: "price_am", STRIPE_PRICE_AGENCY_YEARLY: "price_ay",
  };
  const rp = (p: BillingPlanId, i: BillingInterval) => resolveStripePriceId(p, i, mockEnv);
  const priceMappingOk =
    rp("starter", "monthly") === "price_sm" && rp("starter", "yearly") === "price_sy" &&
    rp("growth", "monthly") === "price_gm" && rp("growth", "yearly") === "price_gy" &&
    rp("agency", "monthly") === "price_am" && rp("agency", "yearly") === "price_ay" &&
    resolveStripePriceId("starter", "monthly", {}) === null &&        // missing → null (truthful unavailable)
    resolveStripePriceId("enterprise", "monthly", mockEnv) === null;  // enterprise is never self-serve
  check("38) resolveStripePriceId maps monthly/yearly to the correct env price (not swapped), null when unset", priceMappingOk);

  // ---------------- Stripe billing config readiness (V1.57.2) ----------------
  const goodEnv: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc", STRIPE_BILLING_PORTAL_RETURN_URL: "https://tamanor.com/dashboard/billing",
    STRIPE_PRICE_STARTER_MONTHLY: "price_sm", STRIPE_PRICE_STARTER_YEARLY: "price_sy",
    STRIPE_PRICE_GROWTH_MONTHLY: "price_gm", STRIPE_PRICE_GROWTH_YEARLY: "price_gy",
    STRIPE_PRICE_AGENCY_MONTHLY: "price_am", STRIPE_PRICE_AGENCY_YEARLY: "price_ay",
  };
  const good = stripeBillingReadiness(goodEnv, { requireLive: true });
  check("42) stripe readiness: complete live config → configured, all components healthy, no duplicate prices",
    good.configured && good.apiConfig === "healthy" && good.prices === "healthy" && good.webhookConfig === "healthy" && good.portalConfig === "healthy" && good.duplicatePriceIds === false);
  const missing = stripeBillingReadiness({ STRIPE_SECRET_KEY: "sk_live_x" }, { requireLive: true });
  check("43) stripe readiness: missing prices/webhook → not configured, fails closed (no invented plan)",
    !missing.configured && missing.prices === "billing_unavailable" && missing.webhookConfig === "billing_unavailable");
  const dup = stripeBillingReadiness({ ...goodEnv, STRIPE_PRICE_GROWTH_MONTHLY: "price_sm" }, { requireLive: true });
  check("44) stripe readiness: duplicate Stripe Price ID across plans is detected + misconfigured",
    dup.duplicatePriceIds === true && dup.prices === "misconfigured" && !dup.configured);
  check("45) unknown Stripe Price ID does not map to any plan (webhook fails closed)",
    planForStripePriceId("price_unknown_xyz", goodEnv) === null && planForStripePriceId("price_sm", goodEnv)?.plan === "starter");
  check("46) stripe test key in production is rejected (requireLive), and readiness leaks no secrets",
    stripeBillingReadiness({ ...goodEnv, STRIPE_SECRET_KEY: "sk_test_x" }, { requireLive: true }).apiConfig === "misconfigured" &&
    !/sk_live_|sk_test_|whsec_|price_/.test(JSON.stringify(good)));

  // ---------------- Duplicate-subscription guard & checkout concurrency (V1.57.3) ----------------
  // Pure decision matrix (never trusts the browser; the exact logic createCheckout enforces server-side).
  const reason = (status: string | null, periodEndMs: number | null): string | null => {
    const d = evaluateCheckoutGuard(status === null ? null : { status, currentPeriodEnd: periodEndMs === null ? null : new Date(periodEndMs) });
    return d.allowed ? null : d.reason;
  };
  const allowed = (status: string | null, periodEndMs: number | null): boolean =>
    evaluateCheckoutGuard(status === null ? null : { status, currentPeriodEnd: periodEndMs === null ? null : new Date(periodEndMs) }).allowed;
  const future = new Date().getTime() + 30 * 24 * 3600 * 1000; // paid period still active
  const past = new Date().getTime() - 24 * 3600 * 1000;        // paid period already ended
  check("47) guard: no subscription → Checkout allowed", allowed(null, null));
  check("48) guard: customer-only 'no_subscription' sentinel → allowed (customer exists, no sub)", allowed("no_subscription", null));
  check("49) guard: active → blocked (subscription_active)", reason("active", future) === "subscription_active");
  check("50) guard: trialing → blocked (subscription_active)", reason("trialing", future) === "subscription_active");
  check("51) guard: past_due → blocked + Portal (payment_update_needed)", reason("past_due", past) === "payment_update_needed");
  check("52) guard: unpaid → blocked (payment_update_needed)", reason("unpaid", null) === "payment_update_needed");
  check("53) guard: paused → blocked (subscription_active)", reason("paused", future) === "subscription_active");
  check("54) guard: cancel-at-period-end still active (status active) → blocked", reason("active", future) === "subscription_active");
  check("55) guard: recoverable incomplete → blocked (complete_payment)", reason("incomplete", null) === "complete_payment");
  check("56) guard: incomplete_expired → allowed (dead first attempt, no recoverable sub)", allowed("incomplete_expired", null));
  check("57) guard: canceled but currentPeriodEnd in the future → blocked (access remains)", reason("canceled", future) === "subscription_active");
  check("58) guard: fully canceled + period ended → allowed (later legitimate re-purchase)", allowed("canceled", past));
  check("59) guard: unknown/future Stripe status → fail-safe blocked (never a silent duplicate)", !allowed("weird_new_status", future));

  // V1.57.3A — STRUCTURAL PRESENCE ONLY. The concurrency GUARANTEE is proven by the executable
  // database-backed suite (packages/db/scripts/checkout-concurrency.test.ts), never by these patterns.
  const REPO = resolve(WEB, "../../");
  const billingRepoSrc = readFileSync(join(REPO, "packages/db/src/billing-repo.ts"), "utf8");
  const serviceSrc = src("src/server/billing/service.ts");
  const migrationSrc = readFileSync(join(REPO, "packages/db/prisma/migrations/20260717100000_v1_57_3a_checkout_attempts/migration.sql"), "utf8");
  check("60) durable reservation: a persistent CREATING attempt is inserted inside the reservation transaction (holds the tenant past the lock, before Stripe)",
    /reserveCheckoutAttempt/.test(billingRepoSrc) && /status:\s*"CREATING"/.test(billingRepoSrc) && /stripeCheckoutAttempt\.create/.test(billingRepoSrc) && /pg_advisory_xact_lock/.test(billingRepoSrc));
  check("61) DB-enforced single live attempt: migration adds a partial unique index on tenantId WHERE status IN (CREATING,OPEN) + RLS FORCE",
    /stripe_checkout_attempts_one_live_per_tenant/.test(migrationSrc) && /WHERE "status" IN \('CREATING', 'OPEN'\)/.test(migrationSrc) && /FORCE ROW LEVEL SECURITY/.test(migrationSrc));
  check("62) createCheckout reserves BEFORE any Stripe customer/session creation (direct-API / repeated-click / different-plan safe)",
    serviceSrc.includes("reserveCheckoutAttempt(") &&
    serviceSrc.indexOf("reserveCheckoutAttempt(") < serviceSrc.indexOf("customers.create") &&
    serviceSrc.indexOf("reserveCheckoutAttempt(") < serviceSrc.indexOf("checkout.sessions.create"));
  check("63) Stripe idempotency key is the per-attempt reserved key — NOT price-derived (stable per attempt, fresh per new attempt)",
    /reservation\.idempotencyKey/.test(serviceSrc) && /\{ idempotencyKey \}/.test(serviceSrc) &&
    /checkout_attempt:\$\{randomUUID\(\)\}/.test(billingRepoSrc) && !/`checkout:\$\{args\.tenantId\}:\$\{priceId\}/.test(serviceSrc));
  check("64) webhook connects the attempt lifecycle (completed/expired by session id) without granting entitlement from the attempt row",
    (() => { const w = src("src/app/api/webhooks/stripe/route.ts"); return /completeCheckoutAttemptBySession/.test(w) && /expireCheckoutAttemptBySession/.test(w) && /checkout\.session\.expired/.test(w); })());
  check("65) reservation/guard block reasons are localized EN/SK/DE on the billing page (no generic unknown error)",
    ["subscription_active", "payment_update_needed", "complete_payment", "checkout_in_progress", "checkout_failed"].every((k) => (billing.match(new RegExp(k + ":", "g"))?.length ?? 0) >= 3));

  // ---------------- Per-plan checkout availability (V1.57.4A) ----------------
  // Full "safe checkout chain" (secret + webhook + portal) so per-PRICE availability is the variable.
  const chain: Record<string, string> = { STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_BILLING_PORTAL_RETURN_URL: "https://tamanor.com/dashboard/billing" };
  const avail = (extra: Record<string, string>) => stripePriceAvailability({ ...chain, ...extra }, { requireLive: true });
  const a1 = avail({ STRIPE_PRICE_STARTER_MONTHLY: "price_sm" });
  check("66) only Starter Monthly configured → Starter Monthly available, Growth/Agency NOT (one missing price never disables others)",
    a1.STARTER_MONTHLY === true && a1.GROWTH_MONTHLY === false && a1.AGENCY_MONTHLY === false);
  const a2 = avail({ STRIPE_PRICE_STARTER_MONTHLY: "price_sm", STRIPE_PRICE_AGENCY_MONTHLY: "price_am" });
  check("67) Starter + Agency Monthly configured → both available, Growth unavailable",
    a2.STARTER_MONTHLY === true && a2.AGENCY_MONTHLY === true && a2.GROWTH_MONTHLY === false);
  check("68) Monthly configured but Yearly missing → Monthly available, Yearly unavailable (per-interval)",
    a1.STARTER_MONTHLY === true && a1.STARTER_YEARLY === false);
  check("69) invalid 'prod_' value → unavailable (fails closed)", avail({ STRIPE_PRICE_STARTER_MONTHLY: "prod_sm" }).STARTER_MONTHLY === false);
  check("70) stray text ('price_x was created') → unavailable (strict price_ shape)", avail({ STRIPE_PRICE_STARTER_MONTHLY: "price_x was created" }).STARTER_MONTHLY === false);
  const dupAvail = avail({ STRIPE_PRICE_STARTER_MONTHLY: "price_dup", STRIPE_PRICE_GROWTH_MONTHLY: "price_dup" });
  check("71) duplicate Price ID across plans → BOTH sharers fail closed", dupAvail.STARTER_MONTHLY === false && dupAvail.GROWTH_MONTHLY === false);
  check("72) safe checkout chain required: valid price but NO webhook/portal → unavailable (Phase 7)",
    stripePriceAvailability({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_PRICE_STARTER_MONTHLY: "price_sm" }, { requireLive: true }).STARTER_MONTHLY === false);
  check("73) availability leaks NO Price IDs (booleans only)", !/price_/.test(JSON.stringify(a2)) && Object.values(a2).every((v) => typeof v === "boolean"));
  check("74) stripePriceKeyFor: self-serve → key, Enterprise → null (never self-serve checkout)",
    stripePriceKeyFor("starter", "monthly") === "STARTER_MONTHLY" && stripePriceKeyFor("agency", "yearly") === "AGENCY_YEARLY" && stripePriceKeyFor("enterprise" as BillingPlanId, "monthly") === null);
  // Billing page: client sends ONLY plan+interval (no price_ ID), uses the real checkout button + copy,
  // renders the small truthful "coming soon" state (not a big fake disabled checkout button), and never
  // calls resolveStripePriceId in the page (server helper resolves availability).
  const checkoutBtn = src("src/app/dashboard/billing/checkout-button.tsx");
  check("75) checkout form sends only controlled plan+interval (no browser price ID / price env) + real button/loading state",
    /name="plan"/.test(billing) && /name="interval"/.test(billing) && !/name="price"/.test(billing) && !/STRIPE_PRICE_/.test(billing) &&
    /continueToPayment/.test(billing) && /useFormStatus/.test(checkoutBtn) && /disabled=\{pending\}/.test(checkoutBtn));
  check("76) unavailable plan → small truthful 'coming soon' (no big fake disabled checkout button); resolveStripePriceId not used in the page",
    /comingSoon/.test(billing) && !/resolveStripePriceId/.test(billing) && stripePriceAvailability({}, { requireLive: true }).STARTER_MONTHLY === false);

  // ---------------- global public footer on landing (V1.61 — shared SiteFooter) ----------------
  const landingV2 = src("src/components/landing-v2/landing-v2.tsx");
  const siteFooter = src("src/components/site-footer.tsx");
  const dashLayoutSrc = src("src/app/dashboard/layout.tsx");
  // Homepage (landing) must render the shared global SiteFooter, not the old stub.
  check("39) landing renders the shared global SiteFooter (not the minimal stub footer)",
    /SiteFooter/.test(landingV2) && /<SiteFooter[\s/>]/.test(landingV2) && !/EU reputation-security platform<\/span>/.test(landingV2));
  // SiteFooter content: uses next/link (no plain <a> internal reloads, no placeholder #), required
  // legal + platform links present, operator identity, truthful "in development" grouping, no Guardora.
  const footerLegalOk = ["/privacy", "/cookies", "/terms", "/security", "/register", "/login", "/contact", "/about", "/integrations/facebook"].every((h) => siteFooter.includes(h));
  check("40) SiteFooter is truthful & link-clean (next/link, legal+platform routes, operator copy, no Guardora, no placeholder #, no localhost)",
    /from ["']next\/link["']/.test(siteFooter) && footerLegalOk &&
    /inDevelopment/.test(siteFooter) && /Infotech Solutions/.test(siteFooter) &&
    !/guardora/i.test(siteFooter) && !/href=["']#["']/.test(siteFooter) && !/localhost|\.vercel\.app/.test(siteFooter) &&
    !/<a\s+href=["']\//.test(siteFooter));
  // The authenticated dashboard shell must NOT render the marketing footer.
  check("41) dashboard layout does not render the public marketing footer (FooterV2/SiteFooter)",
    !/FooterV2|SiteFooter/.test(dashLayoutSrc));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — production readiness (V1.39)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
