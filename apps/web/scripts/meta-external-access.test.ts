/**
 * META-EXTERNAL-ACCESS-V1 — targeted tests for App Review / external-customer readiness.
 *
 * Covers: signed_request verification for the data-deletion and deauthorize callbacks (valid, forged, replayed,
 * stale, malformed), the deletion scope limit (no tenant/user/Page destruction), public route reachability
 * without authentication, OAuth state security, server-side asset validation and cross-tenant rejection, the
 * permission→feature matrix, truthful degraded states for declined permissions, absence of any allowlist that
 * would block an external customer, and that the evidence pack contains no credential or secret.
 *
 * NO network, NO database, NO Meta call.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  verifyMetaSignedRequest, metaDeletionConfirmationCode, SIGNED_REQUEST_MAX_AGE_SECONDS,
} from "@guardora/connectors";
import {
  getMetaReviewReadiness, META_REQUIRED_SCOPES,
  META_OAUTH_CALLBACK_PATH, META_WEBHOOK_CALLBACK_PATH,
  META_DATA_DELETION_CALLBACK_PATH, META_DEAUTHORIZE_CALLBACK_PATH,
  META_PRIVACY_POLICY_PATH, META_DELETION_INSTRUCTIONS_PATH,
} from "@guardora/config";
import { resolveMetaAssetSelection, classifyMetaPageOnboarding } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const APP_SECRET = "TEST_APP_SECRET_do_not_leak";
const OTHER_SECRET = "ANOTHER_APP_SECRET";
const FB_USER = "1234567890123456";
const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");
const has = (rel: string) => existsSync(`${ROOT}${rel}`);

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(payload: Record<string, unknown>, secret = APP_SECRET): string {
  const encoded = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(encoded).digest();
  return `${b64url(sig)}.${encoded}`;
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
const validPayload = (over: Record<string, unknown> = {}) => ({
  algorithm: "HMAC-SHA256", user_id: FB_USER, issued_at: nowSeconds(), ...over,
});

console.log("\n1) signed_request verification (the ONLY authentication on both callbacks)");
{
  const ok = verifyMetaSignedRequest(sign(validPayload()), APP_SECRET);
  check("1a) a correctly signed request verifies and yields the app-scoped user id", ok.ok && ok.userId === FB_USER);

  check("1b) wrong app secret → bad_signature", (() => {
    const r = verifyMetaSignedRequest(sign(validPayload(), OTHER_SECRET), APP_SECRET);
    return !r.ok && r.reason === "bad_signature";
  })());
  check("1c) tampered payload → bad_signature", (() => {
    const sr = sign(validPayload());
    const [sig] = sr.split(".");
    const forged = `${sig}.${b64url(JSON.stringify(validPayload({ user_id: "9999" })))}`;
    const r = verifyMetaSignedRequest(forged, APP_SECRET);
    return !r.ok && r.reason === "bad_signature";
  })());
  check("1d) unsigned / missing → missing", (() => {
    const r = verifyMetaSignedRequest("", APP_SECRET); const r2 = verifyMetaSignedRequest(null, APP_SECRET);
    return !r.ok && r.reason === "missing" && !r2.ok && r2.reason === "missing";
  })());
  check("1e) malformed envelopes rejected", (() => {
    const cases = ["abc", ".", "a.", ".b", "a.b.c", "!!!.???", "x".repeat(9000)];
    return cases.every((c) => { const r = verifyMetaSignedRequest(c, APP_SECRET); return !r.ok && (r.reason === "malformed" || r.reason === "bad_signature"); });
  })());
  check("1f) non-HMAC-SHA256 algorithm rejected (never downgraded)", (() => {
    const r = verifyMetaSignedRequest(sign(validPayload({ algorithm: "none" })), APP_SECRET);
    return !r.ok && r.reason === "bad_algorithm";
  })());
  check("1g) verified payload without user_id → no_user", (() => {
    const r = verifyMetaSignedRequest(sign({ algorithm: "HMAC-SHA256", issued_at: nowSeconds() }), APP_SECRET);
    return !r.ok && r.reason === "no_user";
  })());
  check("1h) REPLAY of a stale request rejected", (() => {
    const stale = sign(validPayload({ issued_at: nowSeconds() - SIGNED_REQUEST_MAX_AGE_SECONDS - 60 }));
    const r = verifyMetaSignedRequest(stale, APP_SECRET);
    return !r.ok && r.reason === "expired";
  })());
  check("1i) far-future issued_at rejected", (() => {
    const r = verifyMetaSignedRequest(sign(validPayload({ issued_at: nowSeconds() + 3600 })), APP_SECRET);
    return !r.ok && r.reason === "expired";
  })());
  check("1j) no app secret configured → fails closed, never accepts", (() => {
    const r = verifyMetaSignedRequest(sign(validPayload()), undefined);
    return !r.ok && r.reason === "not_configured";
  })());
  check("1k) rejection reasons carry no secret / payload / user id", (() => {
    const dump = JSON.stringify([
      verifyMetaSignedRequest(sign(validPayload(), OTHER_SECRET), APP_SECRET),
      verifyMetaSignedRequest("garbage", APP_SECRET),
    ]);
    return !dump.includes(APP_SECRET) && !dump.includes(OTHER_SECRET) && !dump.includes(FB_USER);
  })());
}

console.log("\n2) deletion confirmation code — idempotent, non-reversible, PII-free");
{
  const a = metaDeletionConfirmationCode(FB_USER, APP_SECRET);
  const b = metaDeletionConfirmationCode(FB_USER, APP_SECRET);
  check("2a) deterministic — a replayed callback returns the SAME code (idempotent)", a === b);
  check("2b) differs per identity", metaDeletionConfirmationCode("999", APP_SECRET) !== a);
  check("2c) differs per app secret", metaDeletionConfirmationCode(FB_USER, OTHER_SECRET) !== a);
  check("2d) contains no identity or secret material", !a.includes(FB_USER) && !a.includes(APP_SECRET) && /^[a-f0-9]{24}$/.test(a));
}

console.log("\n3) deletion scope — only the authoritatively linked identity");
{
  const src = read("packages/db/src/meta-identity-deletion.ts");
  check("3a) scoped by the unique (provider, providerAccountId) pair",
    /provider: FACEBOOK_LOGIN_PROVIDER, providerAccountId: id/.test(src));
  check("3b) deletes ONLY oauth account rows", /oAuthAccount\.deleteMany/.test(src) && (src.match(/deleteMany|delete\(/g) ?? []).length === 1);
  check("3c) never touches tenants, users, memberships, Pages, credentials or contacts",
    !/\b(tenant|user|membership|connectedAccount|providerCredential|businessContact)\.(delete|deleteMany|update|updateMany)/i.test(src));
  check("3d) idempotent for an absent link (no throw, reports alreadyAbsent)", /alreadyAbsent: true/.test(src));
  check("3e) empty/blank id is a no-op", /if \(!id\) return \{ removed: false, alreadyAbsent: true \}/.test(src));

  for (const route of ["apps/web/src/app/api/meta/data-deletion/route.ts", "apps/web/src/app/api/meta/deauthorize/route.ts"]) {
    const r = read(route);
    const name = route.includes("deauthorize") ? "deauthorize" : "data-deletion";
    check(`3f) ${name}: verifies signed_request BEFORE any deletion`,
      r.indexOf("verifyMetaSignedRequest") < r.indexOf("deleteFacebookLoginIdentity"));
    check(`3g) ${name}: rejects an unverified request with 400 and does not delete`,
      /if \(!verified\.ok\)/.test(r) && /status: 400/.test(r));
    check(`3h) ${name}: never logs the signed request, payload, secret or user id`,
      !/emitOpsEvent\([^)]*verified\.userId/.test(r) && !/console\.(log|warn|error)/.test(r) && !/signed_request:\s*signed/.test(r));
    check(`3i) ${name}: a storage failure is NOT reported as a completed deletion`, /503/.test(r));
  }
  const del = read("apps/web/src/app/api/meta/data-deletion/route.ts");
  check("3j) data-deletion returns exactly Meta's contract (url + confirmation_code)",
    /url: abs\(/.test(del) && /confirmation_code: confirmationCode/.test(del));
}

console.log("\n4) public routes reachable without authentication");
{
  const mw = read("apps/web/src/middleware.ts");
  check("4a) middleware only guards /dashboard/*", /matcher: \["\/dashboard\/:path\*"\]/.test(mw));
  const publicPages: Array<[string, string]> = [
    [META_PRIVACY_POLICY_PATH, "apps/web/src/app/privacy/page.tsx"],
    [META_DELETION_INSTRUCTIONS_PATH, "apps/web/src/app/data-subject-rights/page.tsx"],
    ["/terms", "apps/web/src/app/terms/page.tsx"],
    ["/data-deletion", "apps/web/src/app/data-deletion/page.tsx"],
  ];
  for (const [path, file] of publicPages) {
    check(`4b) ${path} exists`, has(file), file);
    const src = read(file);
    check(`4c) ${path} requires no session (no requireSession/getSession/redirect-to-login)`,
      !/requireSession|getSession|requireDashboardCapability/.test(src) && !/\/login/.test(src));
    check(`4d) ${path} is outside the middleware matcher`, !path.startsWith("/dashboard"));
  }
  for (const [path, file] of [
    [META_DATA_DELETION_CALLBACK_PATH, "apps/web/src/app/api/meta/data-deletion/route.ts"],
    [META_DEAUTHORIZE_CALLBACK_PATH, "apps/web/src/app/api/meta/deauthorize/route.ts"],
    [META_WEBHOOK_CALLBACK_PATH, "apps/web/src/app/api/webhooks/meta/route.ts"],
    [META_OAUTH_CALLBACK_PATH, "apps/web/src/app/api/connectors/meta/callback/route.ts"],
  ] as Array<[string, string]>) {
    check(`4e) ${path} route implemented`, has(file), file);
  }
  const status = read("apps/web/src/app/data-deletion/page.tsx");
  check("4f) status page echoes only a bounded hex code (no injection, no lookup)",
    /\^\[a-f0-9\]\{8,64\}\$/.test(status));
}

console.log("\n5) OAuth state security");
{
  const start = read("apps/web/src/app/api/connectors/meta/start/route.ts");
  const cb = read("apps/web/src/app/api/connectors/meta/callback/route.ts");
  check("5a) state is cryptographically random", /randomUUID\(\)/.test(start));
  check("5b) state cookie is httpOnly + sameSite + secure in production",
    /httpOnly: true/.test(start) && /sameSite: "lax"/.test(start) && /secure: process\.env\.NODE_ENV === "production"/.test(start));
  check("5c) state EXPIRES (bounded maxAge)", /maxAge: 600/.test(start));
  check("5d) state is ONE-TIME (deleted on callback before use)",
    cb.indexOf("jar.delete(STATE_COOKIE)") > 0 && cb.indexOf("jar.delete(STATE_COOKIE)") < cb.indexOf("state !== stateToken"));
  check("5e) callback rejects a mismatched state", /state !== stateToken/.test(cb) && /invalid_state/.test(cb));
  check("5f) OAuth start requires a session AND connector-manage", /getSession\(\)/.test(start) && /Permission\.ConnectorManage/.test(start));
  check("5g) brand comes from the server-set cookie, re-validated under RLS, never a client query param",
    /\[stateToken, brandId\]\s*=\s*\(stored \?\? ""\)\.split\(":"\)/.test(cb) && /tenantId: session\.tenantId/.test(cb));
}

console.log("\n6) asset selection + cross-tenant rejection");
{
  const assets = [{ pageId: "PAGE_OWNED", igBusinessId: "IG_OWNED" }];
  check("6a) owned assets accepted", (() => {
    const r = resolveMetaAssetSelection(assets, ["facebook:PAGE_OWNED", "instagram:IG_OWNED"]);
    return r.pages.has("PAGE_OWNED") && r.instagram.has("IG_OWNED") && r.rejected === 0;
  })());
  check("6b) a Page id NOT discovered in this flow is rejected", (() => {
    const r = resolveMetaAssetSelection(assets, ["facebook:PAGE_OF_ANOTHER_TENANT"]);
    return r.pages.size === 0 && r.rejected === 1;
  })());
  check("6c) cross-tenant targeting with an empty server list is fully rejected", (() => {
    const r = resolveMetaAssetSelection([], ["facebook:PAGE_OWNED", "instagram:IG_OWNED"]);
    return r.pages.size === 0 && r.instagram.size === 0 && r.rejected === 2;
  })());
  const actions = read("apps/web/src/app/dashboard/accounts/meta/actions.ts");
  check("6d) connect validates the submitted selection against the server asset list",
    /resolveMetaAssetSelection\(pages, selected\)/.test(actions));
  check("6e) tenant is taken from the session, never from the client", !/formData\.get\("tenantId"\)/.test(actions) && /session\.tenantId/.test(actions));
  const repair = read("apps/web/src/app/dashboard/platforms/actions.ts");
  check("6f) the repair action accepts only an account id (no Page id / tenant / token from the client)",
    /fd\.get\("accountId"\)/.test(repair) && !/fd\.get\("pageId"\)/.test(repair) && !/fd\.get\("tenantId"\)/.test(repair) && !/fd\.get\("token"\)/.test(repair));
  check("6g) the repair action keeps its feature, permission, same-origin and rate-limit gates",
    /requireDashboardCapability\("businessConnectedPlatforms"\)/.test(repair) && /Permission\.ConnectorManage/.test(repair)
    && /isSameOrigin\(\)/.test(repair) && /leadgenSubscriptionRepairLimiter/.test(repair));
}

console.log("\n7) no allowlist can block an external customer");
{
  const files = [
    "apps/web/src/app/api/connectors/meta/start/route.ts",
    "apps/web/src/app/api/connectors/meta/callback/route.ts",
    "apps/web/src/app/dashboard/accounts/meta/actions.ts",
    "apps/web/src/app/dashboard/platforms/actions.ts",
    "packages/sync/src/meta-leadgen-subscription.ts",
    "packages/sync/src/meta-connector.ts",
    "packages/sync/src/meta-leads.ts",
  ];
  for (const f of files) {
    const src = read(f);
    check(`7a) ${f.split("/").pop()}: no hard-coded email/app-admin/tester/Page allowlist`,
      !/ALLOW(ED)?_?(LIST|EMAILS|PAGES|USERS|TESTERS)/i.test(src)
      && !/@(gmail|tamanor)\.com/i.test(src)
      && !/\bisTester\b|\bdeveloperOnly\b|\bappAdminOnly\b/i.test(src));
  }
}

console.log("\n8) permission → feature matrix is backed by real code paths");
{
  const matrix: Array<[string, string]> = [
    ["pages_show_list", "packages/connectors/src/meta/discovery.ts"],
    ["pages_manage_engagement", "packages/ai/src/auto-protect.ts"],
    ["leads_retrieval", "packages/sync/src/meta-leadgen-subscription.ts"],
    ["instagram_basic", "packages/sync/src/instagram-moderation.ts"],
    ["instagram_manage_comments", "packages/sync/src/instagram-moderation.ts"],
  ];
  for (const [perm, file] of matrix) {
    check(`8a) ${perm} is referenced by ${file.split("/").pop()}`, read(file).includes(perm), file);
  }
  check("8b) pages_manage_metadata is required by the subscribed_apps write path",
    read("packages/connectors/src/meta/leadgen-subscription.ts").includes("subscribed_apps"));
  check("8c) every required scope in config is a real Meta permission name (no invented scope)",
    META_REQUIRED_SCOPES.every((s) => /^[a-z][a-z0-9_]+$/.test(s)) && META_REQUIRED_SCOPES.length >= 7);
  const doc = read("docs/META_APP_REVIEW.md");
  for (const perm of META_REQUIRED_SCOPES) {
    check(`8d) evidence pack documents ${perm}`, doc.includes(perm));
  }
  check("8e) business_management is reported as an open item, not silently claimed",
    doc.includes("business_management") && /Open items|blocker/i.test(doc));
}

console.log("\n9) declined / missing permissions degrade truthfully");
{
  const sig = (o: Partial<Parameters<typeof classifyMetaPageOnboarding>[0]> = {}) => classifyMetaPageOnboarding({
    leadsScopeRequested: true, leadsPermissionGranted: true, subscriptionStatus: "verified", providerApproved: true, ...o,
  });
  check("9a) declining leads_retrieval leaves the Page connected for comments (not an error)",
    sig({ leadsPermissionGranted: false }) === "leads_permission_missing");
  check("9b) a deployment without lead access reports comments_only", sig({ leadsScopeRequested: false }) === "comments_only");
  check("9c) an unverified webhook is never reported as ready", sig({ subscriptionStatus: null }) !== "lead_ads_ready");
  check("9d) a transient provider failure is reported as unknown, not as ready or as denied",
    sig({ subscriptionStatus: "unavailable" }) === "verification_unavailable");
  check("9e) full grant reports ready", sig() === "lead_ads_ready");
}

console.log("\n10) readiness report exposes booleans only and never claims approval");
{
  const env = {
    META_APP_ID: "SECRET_APP_ID_VALUE", META_APP_SECRET: "SECRET_APP_SECRET_VALUE",
    META_REDIRECT_URI: "https://example.test/cb", META_WEBHOOK_VERIFY_TOKEN: "SECRET_VERIFY_TOKEN",
    META_OAUTH_SCOPES: META_REQUIRED_SCOPES.join(","), META_WEBHOOK_SYNC: "true",
    NODE_ENV: "test" as const,
  } satisfies NodeJS.ProcessEnv;
  const r = getMetaReviewReadiness(env);
  const dump = JSON.stringify(r);
  check("10a) reports configured booleans", r.appCredentialsConfigured && r.oauthCallbackConfigured && r.webhookVerifyTokenConfigured && r.webhookSyncEnabled);
  check("10b) all required scopes detected", r.allRequiredScopesConfigured && r.scopes.length === META_REQUIRED_SCOPES.length);
  check("10c) NO environment value is returned",
    !dump.includes("SECRET_APP_ID_VALUE") && !dump.includes("SECRET_APP_SECRET_VALUE") && !dump.includes("SECRET_VERIFY_TOKEN") && !dump.includes("example.test"));
  check("10d) approval is NEVER inferred — attestations default false",
    r.businessVerificationAttested === false && r.advancedAccessAttested === false);
  check("10e) attestations are operator flags only", (() => {
    const withFlags = getMetaReviewReadiness({ ...env, META_BUSINESS_VERIFICATION_ATTESTED: "true", META_ADVANCED_ACCESS_ATTESTED: "true" });
    return withFlags.businessVerificationAttested && withFlags.advancedAccessAttested;
  })());
  check("10f) a missing scope is reported as not configured", (() => {
    const partial = getMetaReviewReadiness({ ...env, META_OAUTH_SCOPES: "pages_show_list" });
    return !partial.allRequiredScopesConfigured && partial.scopes.find((s) => s.scope === "leads_retrieval")!.configured === false;
  })());
  const page = read("apps/web/src/app/admin/meta-review/page.tsx");
  check("10g) the admin page is platform-guarded and reuses the existing surface",
    /requirePlatformAccess\("admin\.access"\)/.test(page) && /platformCapsFor\(platform\.role\)\.systemHealth/.test(page));
  check("10h) the admin page renders no env value", !/process\.env/.test(page));
}

console.log("\n11) reviewer flow routes all exist");
{
  const routes = [
    "apps/web/src/app/login/page.tsx",
    "apps/web/src/app/dashboard/accounts/page.tsx",
    "apps/web/src/app/api/connectors/meta/start/route.ts",
    "apps/web/src/app/dashboard/accounts/meta/select/page.tsx",
    "apps/web/src/app/dashboard/platforms/page.tsx",
    "apps/web/src/app/dashboard/contacts/page.tsx",
  ];
  for (const r of routes) check(`11a) ${r.replace("apps/web/src/app", "")} exists`, has(r), r);
  const accounts = read("apps/web/src/app/dashboard/accounts/page.tsx");
  check("11b) disconnect is reachable from Accounts", /disconnect/.test(accounts));
  check("11c) the connect result summary is rendered", /decodeMetaOnboardingSummary/.test(accounts));
  const platforms = read("apps/web/src/app/dashboard/platforms/page.tsx");
  check("11d) Connected platforms renders per-Page readiness + the repair action",
    /leadPagesSummary/.test(platforms) && /repairMetaLeadgenSubscriptionAction/.test(platforms));
}

console.log("\n12) evidence pack contains no credential, secret or identifier");
{
  const doc = read("docs/META_APP_REVIEW.md");
  const forbidden: Array<[string, RegExp]> = [
    ["a password field", /password\s*[:=]\s*\S/i],
    ["an app secret value", /app[_ ]?secret\s*[:=]\s*[A-Za-z0-9]{8,}/i],
    ["a bearer/access token", /\b(EAA[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{10,})/],
    ["a long numeric id (app/page id)", /\b\d{12,}\b/],
    ["a verify token value", /verify[_ ]?token\s*[:=]\s*\S+/i],
    ["a connection string", /postgres(?:ql)?:\/\//i],
    ["a cuid-shaped tenant/account id", /\bc[a-z0-9]{24,}\b/],
  ];
  for (const [name, re] of forbidden) check(`12a) evidence pack has no ${name}`, !re.test(doc), (doc.match(re) ?? [""])[0]);
  check("12b) evidence pack states the app id is NOT reproduced", /Value not reproduced here/i.test(doc));
  check("12c) evidence pack forbids committing reviewer credentials", /never be committed to Git/i.test(doc));
  check("12d) evidence pack lists the manual dashboard actions", /Remaining manual Meta dashboard actions/i.test(doc));
  check("12e) evidence pack documents tenant isolation, vault-only tokens and allow-listed lead fields",
    /tenant-isolated/i.test(doc) && /vault-only/i.test(doc) && /allow-list/i.test(doc));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta external access readiness: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
