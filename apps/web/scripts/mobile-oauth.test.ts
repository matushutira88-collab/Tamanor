/**
 * M7 — native connector OAuth API.
 *
 * Deterministic tests in the house harness: no database, no Next, no provider. The
 * service is dependency-injected, so every rule is exercised against a fake
 * `OAuthDeps` that records exactly what the handlers asked for.
 *
 * Asserted FIRST, because their violation would be unsafe rather than merely wrong:
 *   - UNIFIED AUTH: one User, one Tenant, one UserSession infrastructure. No mobile
 *     account system exists, and provider OAuth creates no user or tenant.
 *   - NO TAMANOR CREDENTIAL IN THE BROWSER: the authorization URL carries no bearer,
 *     session token or client secret, and no `tamanor_session` is ever minted.
 *   - REPLAY: OAuth state is single-use, hashed at rest, and atomically consumed.
 *   - THE DEEP LINK IS NOT AUTHORITATIVE: it carries a correlation id and nothing
 *     that could be mistaken for proof.
 *
 * Then the product rules: RBAC, workspace, tenancy, connect/reconnect targets,
 * selection, entitlement preservation, expiry and bounded error normalization.
 *
 * Run: pnpm mobile-oauth:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  OAUTH_INTENTS, OAUTH_PROVIDERS, OAUTH_RESULT_CODES, OAUTH_STATUSES, OAUTH_TTL_MS,
  effectiveStatus, handleOAuthCancel, handleOAuthOptions, handleOAuthProviders,
  handleOAuthSelect, handleOAuthStart, handleOAuthStatus, providerForPlatform, toFlowDto,
  type FlowRecord, type OAuthDeps,
} from "../src/server/mobile-oauth";
import {
  OAUTH_FLOW_STATUSES, generateOAuthState, hashOAuthState, isTerminalFlowStatus, statesMatch,
} from "@guardora/db";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "..", rel), "utf8");
const readRepo = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");
/** Source with comments stripped — an assertion must never be satisfied by prose. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const codeOf = (rel: string) => strip(readSrc(rel));
const repoCodeOf = (rel: string) => strip(readRepo(rel));
const dump = (o: unknown) => JSON.stringify(o);

/** Every server module that participates in native OAuth. */
const OAUTH_MODULES = [
  "src/server/mobile-oauth.ts",
  "src/server/mobile-oauth-deps.ts",
  "src/server/oauth/actor.ts",
  "src/server/oauth/mobile-callback.ts",
  "src/server/oauth/meta-oauth-service.ts",
  "src/server/oauth/meta-selection-service.ts",
  "src/app/api/mobile/oauth/start/route.ts",
  "src/app/api/mobile/oauth/providers/route.ts",
  "src/app/api/mobile/oauth/flows/[flowId]/route.ts",
  "src/app/api/mobile/oauth/flows/[flowId]/options/route.ts",
  "src/app/api/mobile/oauth/flows/[flowId]/select/route.ts",
  "src/app/api/mobile/oauth/flows/[flowId]/cancel/route.ts",
];

const CALLBACKS = [
  "src/app/api/connectors/meta/callback/route.ts",
  "src/app/api/connectors/google-business/callback/route.ts",
];

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const AUTH = "Bearer good-token";
const NOW = new Date("2026-03-01T12:00:00.000Z");

const flow = (over: Partial<FlowRecord> = {}): FlowRecord => ({
  id: "flow-1",
  userId: "u1",
  tenantId: "tenant-a",
  sessionId: "sess-1",
  surface: "mobile",
  provider: "meta",
  intent: "connect",
  brandId: "brand-1",
  accountId: null,
  status: "pending",
  resultCode: null,
  resultAccountId: null,
  resultRefId: null,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + OAUTH_TTL_MS),
  stateConsumedAt: null,
  completedAt: null,
  ...over,
});

interface Spy {
  created: Record<string, unknown>[];
  finalized: Record<string, unknown>[];
  audits: { event: string; metadata: Record<string, unknown> }[];
  selections: { selected: readonly string[]; tenantId: string }[];
  urls: { provider: string; state: string }[];
}
const spy = (): Spy => ({ created: [], finalized: [], audits: [], selections: [], urls: [] });

function makeDeps(over: Partial<OAuthDeps> = {}, s: Spy = spy()): OAuthDeps {
  return {
    readUserSession: async (token) =>
      token === "good-token"
        ? {
            ok: true,
            session: {
              sessionId: "sess-1", userId: "u1", tenantId: "tenant-a", role: "owner",
              emailVerified: true, workspaceKind: "business",
            } as never,
          }
        : { ok: false, reason: "session_revoked" as never },
    classifyWorkspace: () => "business",
    emitOpsEvent: () => {},
    canManageConnectors: () => true,
    providerAvailability: () => [
      { provider: "meta", configured: true, available: true, approved: true },
      { provider: "google_business", configured: true, available: true, approved: true },
    ],
    listBrands: async () => [{ id: "brand-1", name: "Tamanor" }],
    findBrand: async ({ brandId }) => (brandId === "brand-1" ? { id: "brand-1" } : null),
    findAccount: async ({ accountId }) =>
      accountId === "acct-1"
        ? { id: "acct-1", brandId: "brand-1", platform: "facebook_page" }
        : accountId === "acct-gbp"
          ? { id: "acct-gbp", brandId: "brand-1", platform: "google_business" }
          : null,
    generateState: () => generateOAuthState(),
    hashState: (v) => hashOAuthState(v),
    createFlow: async (i) => { s.created.push(i as never); return { id: "flow-1" }; },
    buildAuthorizationUrl: ({ provider, state }) => {
      s.urls.push({ provider, state });
      return provider === "meta"
        ? { ok: true, url: `https://www.facebook.com/v21.0/dialog/oauth?client_id=APPID&redirect_uri=https%3A%2F%2Ftamanor.com%2Fapi%2Fconnectors%2Fmeta%2Fcallback&scope=pages_show_list&state=${state}` }
        : { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=GID&redirect_uri=https%3A%2F%2Ftamanor.com%2Fcb&scope=business.manage&state=${state}` };
    },
    readFlow: async () => flow(),
    finalizeFlow: async (i) => { s.finalized.push(i as never); return true; },
    loadOptions: async () => [
      { id: "facebook:PAGE_A", displayName: "Page A", kind: "facebook_page", alreadyConnected: false, eligible: true, reason: null },
      { id: "instagram:IG_A", displayName: "@iga", kind: "instagram_business", alreadyConnected: false, eligible: true, reason: null },
    ],
    applySelection: async ({ flow: f, selected }) => {
      s.selections.push({ selected, tenantId: f.tenantId });
      return { ok: true, connected: 1, monitored: 1, limited: 0, slotTaken: 0, rejected: 0, accountIds: ["acct-new"] };
    },
    writeAudit: async (a) => { s.audits.push({ event: a.event, metadata: a.metadata }); },
    now: () => NOW,
    ...over,
  };
}

const allStrings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => allStrings(x, out));
  return out;
};
const allKeys = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) { out.push(k); allKeys(val, out); }
  return out;
};

/* -------------------------------------------------------------------------- */
/* 1. UNIFIED AUTH — one account system                                        */
/* -------------------------------------------------------------------------- */

console.log("\n1. Unified auth");

{
  // Both transports resolve the SAME UserSession table through the SAME function.
  const mobileAuth = codeOf("src/server/mobile-auth-deps.ts");
  const oauthDeps = codeOf("src/server/mobile-oauth-deps.ts");
  check("mobile OAuth authenticates with the canonical readUserSession",
    /readUserSession/.test(oauthDeps));
  check("mobile auth uses the same canonical readUserSession", /readUserSession/.test(mobileAuth));
  const sessionCore = repoCodeOf("packages/db/src/session.ts");
  check("readUserSession reads the ONE UserSession table",
    /userSession\.findUnique\(\{ where: \{ tokenHash/.test(sessionCore));
  check("the session row is looked up by a HASH, never a stored raw token",
    /hashSessionToken\(token\)/.test(sessionCore));
}
for (const forbidden of ["MobileUser", "MobileTenant", "MobileSession", "MobileConnectedAccount", "MobileOAuthConnection", "mobileUserId", "mobileTenantId"]) {
  const schema = repoCodeOf("packages/db/prisma/schema.prisma");
  check(`the schema declares no "${forbidden}"`, !schema.includes(forbidden));
}
for (const vendor of ["firebase", "Clerk", "auth0", "Auth0", "supabase", "NextAuth", "next-auth"]) {
  const offenders = OAUTH_MODULES.filter((m) => codeOf(m).includes(vendor));
  check(`no OAuth module references "${vendor}"`, offenders.length === 0, dump(offenders));
}
{
  // Provider OAuth connects a platform; it must never create an identity.
  const all = OAUTH_MODULES.map(codeOf).join("\n") + CALLBACKS.map(codeOf).join("\n");
  check("no OAuth path creates a User", !/\buser\.create\(|users\.create\(/.test(all));
  check("no OAuth path creates a Tenant", !/tenant\.create\(/.test(all));
  check("no OAuth path creates a Membership", !/membership\.create\(/.test(all));
  check("no OAuth path creates a UserSession", !/userSession\.create\(/.test(all));
}
{
  // The actor is a pure relabel of the SAME session shape.
  const actor = codeOf("src/server/oauth/actor.ts");
  check("the web and mobile actors differ only by `surface`",
    /surface: "web"/.test(actor) && /surface: "mobile"/.test(actor));
  check("the actor carries a sessionId, never a session token",
    /sessionId: session\.sessionId/.test(actor) && !/token/i.test(actor));
  check("the actor performs no authorization of its own",
    !/readUserSession|can\(|assertCan/.test(actor));
}

/* -------------------------------------------------------------------------- */
/* 2. NO TAMANOR CREDENTIAL IN THE BROWSER                                     */
/* -------------------------------------------------------------------------- */

console.log("\n2. No Tamanor credential in the browser");

{
  const s = spy();
  const res = await handleOAuthStart(
    { authorization: AUTH, body: { provider: "meta", intent: "connect", brandId: "brand-1" } },
    makeDeps({}, s),
  );
  const body = res.body as unknown as { flowId: string; authorizationUrl: string; expiresAt: string };
  check("start succeeds", res.status === 200, dump(res.body));

  const url = body.authorizationUrl;
  check("the authorization URL is the PROVIDER's", /^https:\/\/(www\.facebook\.com|accounts\.google\.com)\//.test(url), url);
  check("the authorization URL carries NO bearer", !/good-token/.test(url) && !/[Bb]earer/.test(url));
  check("the authorization URL carries NO session token", !/tamanor_session|sessionId|sess-1/.test(url));
  check("the authorization URL carries NO client secret", !/client_secret|appsecret/i.test(url));
  check("the authorization URL carries NO tenant or user id", !/tenant-a|u1/.test(url));
  check("the authorization URL DOES carry a normal OAuth state", /[?&]state=/.test(url));
  check("the state in the URL is the RAW state we generated",
    s.urls.length === 1 && url.includes(encodeURIComponent(s.urls[0]!.state).replace(/%2D/g, "-")) || url.includes(s.urls[0]!.state));

  const strings = allStrings(res.body);
  check("the start reply leaks no bearer", !strings.some((x) => x.includes("good-token")));
}
check("no `tamanor_session` is set anywhere in the OAuth path",
  !OAUTH_MODULES.some((m) => /tamanor_session/.test(codeOf(m))));
check("no OAuth module calls startSession",
  !OAUTH_MODULES.some((m) => /startSession/.test(codeOf(m))));
check("the previously-rejected bridge design does not exist",
  !OAUTH_MODULES.concat(CALLBACKS).some((m) => /handoffSecret|tamanor_mobile_oauth|oauth\/bridge/.test(codeOf(m))));
{
  // The callbacks may set only the pre-existing web cookies, never a session.
  const metaCb = codeOf("src/app/api/connectors/meta/callback/route.ts");
  const setCookies = [...metaCb.matchAll(/jar\.set\(([A-Z_]+)/g)].map((m) => m[1]);
  check("the Meta callback sets only the onboarding cookie", dump(setCookies) === dump(["ONBOARDING_COOKIE"]), dump(setCookies));
  check("the mobile branch reads no cookie at all",
    !/mobile\.kind === "resolved"[\s\S]{0,2000}cookies\(\)/.test(metaCb));
}

/* -------------------------------------------------------------------------- */
/* 3. STATE: entropy, hashing, replay                                          */
/* -------------------------------------------------------------------------- */

console.log("\n3. OAuth state");

{
  const a = generateOAuthState();
  const b = generateOAuthState();
  check("state is high-entropy (>= 32 bytes base64url)", Buffer.from(a, "base64url").length >= 32, String(Buffer.from(a, "base64url").length));
  check("state is unique per call", a !== b);
  check("state is URL-safe", /^[A-Za-z0-9_-]+$/.test(a), a);

  const h = hashOAuthState(a);
  check("the hash is sha256 hex", /^[0-9a-f]{64}$/.test(h), h);
  check("hashing is deterministic", hashOAuthState(a) === h);
  check("a different state hashes differently", hashOAuthState(b) !== h);
  check("the hash does not contain the state", !h.includes(a.slice(0, 12)));
  check("statesMatch is exact", statesMatch(a, a) && !statesMatch(a, b));
  check("statesMatch handles a length mismatch without throwing", statesMatch(a, a + "x") === false);
}
{
  const repo = repoCodeOf("packages/db/src/connector-oauth-flow.ts");
  check("only the HASH is ever written", /stateHash: input\.stateHash/.test(repo) && !/stateRaw|rawState:/.test(repo));
  check("the consume is a single guarded updateMany (no read-then-write)",
    /updateMany\(\{[\s\S]{0,300}stateConsumedAt: null,[\s\S]{0,200}expiresAt: \{ gt: now \}/.test(repo));
  check("the guard also excludes terminal flows", /status: \{ notIn: \[\.\.\.TERMINAL\] \}/.test(repo));
  check("exactly one winner is accepted", /guarded\.count === 1/.test(repo));
  check("the repository stores no credential of any kind",
    !/accessToken|refreshToken|bearer|clientSecret|password/i.test(repo));
  check("only ONE function uses the system client for the callback lookup",
    (repo.match(/systemDb\.connectorOAuthFlow\.updateMany/g) ?? []).length === 1);
  check("the system lookup takes no tenantId parameter (cannot be aimed elsewhere)",
    /export async function consumeConnectorOAuthState\(\s*stateHash: string,\s*now: Date/.test(repo));
  check("every other read is tenant-scoped",
    /readConnectorOAuthFlow[\s\S]{0,300}withTenantDb/.test(repo)
    && /createConnectorOAuthFlow[\s\S]{0,400}withTenantDb/.test(repo));
}
{
  const schema = readRepo("packages/db/prisma/schema.prisma");
  check("stateHash is UNIQUE in the schema — the replay guard", /stateHash\s+String\s+@unique/.test(schema));
  const migration = readRepo("packages/db/prisma/migrations/20260903090000_connector_oauth_flow/migration.sql");
  check("the migration creates a UNIQUE index on stateHash",
    /CREATE UNIQUE INDEX IF NOT EXISTS "connector_oauth_flows_stateHash_key"/.test(migration));
  check("the migration enables and FORCES RLS",
    /ENABLE ROW LEVEL SECURITY/.test(migration) && /FORCE ROW LEVEL SECURITY/.test(migration));
  check("the migration creates a tenant isolation policy",
    /CREATE POLICY tenant_isolation ON "connector_oauth_flows"/.test(migration)
    && /current_app_tenant_id\(\)/.test(migration));
  check("the migration grants the app role its needed privileges",
    /GRANT SELECT, INSERT, UPDATE, DELETE ON "connector_oauth_flows" TO tamanor_app/.test(migration));
  check("the migration is additive only",
    !/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i.test(migration));
  // SQL comments explain what is deliberately absent, so they are stripped before
  // the scan — otherwise the prose would fail its own assertion.
  const migrationSql = migration.replace(/^\s*--.*$/gm, "");
  check("the migration declares no credential column",
    !/accessToken|refreshToken|clientSecret|"code"|bearer/i.test(migrationSql), 
    (migrationSql.match(/accessToken|refreshToken|clientSecret|"code"|bearer/gi) ?? []).join(","));
  check("all three FKs cascade", (migration.match(/ON DELETE CASCADE/g) ?? []).length === 3);
}

/* -------------------------------------------------------------------------- */
/* 4. TTL and expiry                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n4. TTL");

check("the TTL is 10 minutes", OAUTH_TTL_MS === 10 * 60 * 1000, String(OAUTH_TTL_MS));
check("the TTL is within the brief's maximum", OAUTH_TTL_MS <= 10 * 60 * 1000);
{
  const s = spy();
  await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "connect", brandId: "brand-1" } }, makeDeps({}, s));
  const created = s.created[0] as { expiresAt: Date };
  check("the created flow expires in exactly the TTL",
    created.expiresAt.getTime() - NOW.getTime() === OAUTH_TTL_MS);
}
{
  const stale = flow({ expiresAt: new Date(NOW.getTime() - 1000), status: "pending" });
  check("an expired pending flow reads as expired", effectiveStatus(stale, NOW) === "expired");
  check("an expired selection_required flow reads as expired",
    effectiveStatus(flow({ status: "selection_required", expiresAt: new Date(NOW.getTime() - 1) }), NOW) === "expired");
  check("a COMPLETED flow past its TTL still reads as completed",
    effectiveStatus(flow({ status: "completed", expiresAt: new Date(NOW.getTime() - 1) }), NOW) === "completed");
  check("a FAILED flow past its TTL still reads as failed",
    effectiveStatus(flow({ status: "failed", expiresAt: new Date(NOW.getTime() - 1) }), NOW) === "failed");
  check("a CANCELLED flow past its TTL still reads as cancelled",
    effectiveStatus(flow({ status: "cancelled", expiresAt: new Date(NOW.getTime() - 1) }), NOW) === "cancelled");
  check("an unknown stored status degrades to failed, never to completed",
    effectiveStatus(flow({ status: "banana" }), NOW) === "failed");
  check("a prototype status degrades to failed",
    effectiveStatus(flow({ status: "__proto__" }), NOW) === "failed");
}
{
  // Scoped to the flow lifecycle. The Meta onboarding row has its own, separate
  // canonical TTL, which is not a flow extension.
  const flowModules = ["src/server/mobile-oauth.ts", "src/server/mobile-oauth-deps.ts", "src/server/oauth/mobile-callback.ts"];
  check("there is no flow TTL extension anywhere",
    !flowModules.some((m) => /extendFlow|refreshExpiry|renewFlow/.test(codeOf(m))));
  const repo = repoCodeOf("packages/db/src/connector-oauth-flow.ts");
  check("the repository exposes no way to extend a flow",
    !/expiresAt:\s*new Date/.test(repo) && !/extend|renew/i.test(repo));
  check("the flow expiry is set once, at creation, from the TTL",
    /expiresAt = new Date\(now\.getTime\(\) \+ OAUTH_TTL_MS\)/.test(codeOf("src/server/mobile-oauth.ts")));
}

/* -------------------------------------------------------------------------- */
/* 5. Start — auth, RBAC, workspace, tenancy                                   */
/* -------------------------------------------------------------------------- */

console.log("\n5. Start: auth and gating");

const HANDLERS: [string, (a: string | null, d: OAuthDeps) => Promise<{ status: number; body: Record<string, unknown> }>][] = [
  ["providers", (a, d) => handleOAuthProviders({ authorization: a }, d)],
  ["start", (a, d) => handleOAuthStart({ authorization: a, body: { provider: "meta", intent: "connect", brandId: "brand-1" } }, d)],
  ["status", (a, d) => handleOAuthStatus({ authorization: a, flowId: "flow-1" }, d)],
  ["options", (a, d) => handleOAuthOptions({ authorization: a, flowId: "flow-1" }, d)],
  ["select", (a, d) => handleOAuthSelect({ authorization: a, flowId: "flow-1", body: { selected: ["facebook:PAGE_A"] } }, d)],
  ["cancel", (a, d) => handleOAuthCancel({ authorization: a, flowId: "flow-1" }, d)],
];
for (const [name, call] of HANDLERS) {
  check(`${name}: a missing bearer is 401`, (await call(null, makeDeps())).status === 401);
  check(`${name}: a malformed bearer is 401`, (await call("Token abc", makeDeps())).status === 401);
  check(`${name}: a bare "Bearer" is 401`, (await call("Bearer", makeDeps())).status === 401);
  {
    const r = await call("Bearer revoked", makeDeps());
    check(`${name}: a revoked session is 401 session_revoked`, r.status === 401 && r.body.error === "session_revoked");
  }
  {
    const d = makeDeps({
      readUserSession: async () => ({ ok: true, session: { sessionId: "s", userId: "u", tenantId: "t", role: "owner", emailVerified: false, workspaceKind: "business" } as never }),
    });
    const r = await call(AUTH, d);
    check(`${name}: an unverified email is 403`, r.status === 403 && r.body.error === "verification_required");
  }
  {
    const r = await call(AUTH, makeDeps({ classifyWorkspace: () => "family" }));
    check(`${name}: a FAMILY workspace is 403`, r.status === 403 && r.body.error === "workspace_unsupported");
  }
  {
    const r = await call(AUTH, makeDeps({ classifyWorkspace: () => "unsupported" }));
    check(`${name}: an unknown workspace is 403`, r.status === 403 && r.body.error === "workspace_unsupported");
  }
}
for (const [name, call] of HANDLERS.filter(([n]) => n !== "providers" && n !== "status")) {
  const r = await call(AUTH, makeDeps({ canManageConnectors: () => false }));
  check(`${name}: a viewer is denied`, r.status === 403 && r.body.error === "permission_denied", dump(r.body));
}
check("a viewer may still READ providers", (await handleOAuthProviders({ authorization: AUTH }, makeDeps({ canManageConnectors: () => false }))).status === 200);
check("a viewer may still READ status", (await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, makeDeps({ canManageConnectors: () => false }))).status === 200);

{
  const s = spy();
  await handleOAuthStart({
    authorization: AUTH,
    // Forged identity in the body must change nothing.
    body: { provider: "meta", intent: "connect", brandId: "brand-1", tenantId: "tenant-b", userId: "u9", role: "owner", sessionId: "sess-9" },
  }, makeDeps({}, s));
  const c = s.created[0] as { tenantId: string; userId: string; sessionId: string };
  check("a forged tenantId in the body is ignored", c.tenantId === "tenant-a");
  check("a forged userId in the body is ignored", c.userId === "u1");
  check("a forged sessionId in the body is ignored", c.sessionId === "sess-1");
}
check("the service never reads a tenant from the request",
  !/body\.tenantId|raw\.tenantId|req\.tenantId/.test(codeOf("src/server/mobile-oauth.ts")));

/* -------------------------------------------------------------------------- */
/* 6. Start — provider and target validation                                   */
/* -------------------------------------------------------------------------- */

console.log("\n6. Start: providers and targets");

for (const p of OAUTH_PROVIDERS) {
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: p, intent: "connect", brandId: "brand-1" } }, makeDeps());
  check(`provider "${p}" can start a connect`, r.status === 200, dump(r.body));
}
for (const bad of ["tiktok", "", null, 1, "__proto__", "META"]) {
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: bad, intent: "connect", brandId: "brand-1" } }, makeDeps());
  check(`an invalid provider ${dump(bad)} is 400`, r.status === 400, dump(r.body));
}
for (const bad of ["disconnect", "", null, "__proto__"]) {
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: bad, brandId: "brand-1" } }, makeDeps());
  check(`an invalid intent ${dump(bad)} is 400`, r.status === 400);
}
{
  const d = makeDeps({ providerAvailability: () => [{ provider: "meta", configured: false, available: false, approved: false }] });
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "connect", brandId: "brand-1" } }, d);
  check("an unconfigured provider is 409 provider_unavailable", r.status === 409 && r.body.error === "provider_unavailable");
}
{
  const d = makeDeps({ providerAvailability: () => [{ provider: "google_business", configured: true, available: false, approved: false }] });
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "google_business", intent: "connect", brandId: "brand-1" } }, d);
  check("an unapproved Google is 409 provider_unavailable", r.status === 409);
}
{
  const s = spy();
  const d = makeDeps({ buildAuthorizationUrl: () => ({ ok: false, reason: "not_configured" }) }, s);
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "connect", brandId: "brand-1" } }, d);
  check("a URL that cannot be built is 409, and NO flow is created",
    r.status === 409 && s.created.length === 0);
}
// CONNECT targets
{
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "connect", brandId: "brand-FOREIGN" } }, makeDeps());
  check("a foreign brand is 404 not_found", r.status === 404 && r.body.error === "not_found");
}
for (const bad of ["", "   ", null, undefined, 42]) {
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "connect", brandId: bad } }, makeDeps());
  check(`connect without a usable brand ${dump(bad)} is 400`, r.status === 400);
}
// RECONNECT targets
{
  const s = spy();
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "reconnect", accountId: "acct-1" } }, makeDeps({}, s));
  const c = s.created[0] as { accountId: string; brandId: string; provider: string };
  check("reconnect succeeds for a real account", r.status === 200, dump(r.body));
  check("reconnect binds the flow to that account", c.accountId === "acct-1");
  check("reconnect DERIVES the brand from the account", c.brandId === "brand-1");
  check("reconnect derives the provider from the platform", c.provider === "meta");
}
{
  const s = spy();
  // A spoofed brandId on a reconnect must be ignored entirely.
  await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "reconnect", accountId: "acct-1", brandId: "brand-EVIL" } }, makeDeps({}, s));
  check("a spoofed brand on reconnect is ignored", (s.created[0] as { brandId: string }).brandId === "brand-1");
}
{
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "reconnect", accountId: "acct-FOREIGN" } }, makeDeps());
  check("a foreign account is 404 not_found", r.status === 404 && r.body.error === "not_found");
}
{
  // A Google account cannot be reconnected through the Meta provider.
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "reconnect", accountId: "acct-gbp" } }, makeDeps());
  check("a provider/platform mismatch is rejected, not silently corrected", r.status === 400, dump(r.body));
}
{
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "google_business", intent: "reconnect", accountId: "acct-gbp" } }, makeDeps());
  check("a Google account reconnects through Google", r.status === 200);
}
{
  const d = makeDeps({ findAccount: async () => ({ id: "x", brandId: "b", platform: "linkedin_company" }) });
  const r = await handleOAuthStart({ authorization: AUTH, body: { provider: "meta", intent: "reconnect", accountId: "x" } }, d);
  check("an unsupported platform cannot be reconnected", r.status === 409 || r.status === 400, dump(r.body));
}
check("providerForPlatform maps only the real platforms",
  providerForPlatform("facebook_page") === "meta"
  && providerForPlatform("instagram_business") === "meta"
  && providerForPlatform("google_business") === "google_business"
  && providerForPlatform("tiktok") === null
  && providerForPlatform("__proto__") === null);

/* -------------------------------------------------------------------------- */
/* 7. Providers listing                                                        */
/* -------------------------------------------------------------------------- */

console.log("\n7. Providers listing");

{
  const res = await handleOAuthProviders({ authorization: AUTH }, makeDeps());
  const keys = allKeys(res.body);
  check("providers is 200", res.status === 200);
  check("availability is returned", keys.includes("configured") && keys.includes("available") && keys.includes("approved"));
  for (const forbidden of ["clientId", "client_id", "clientSecret", "redirectUri", "scope", "scopes", "appId", "appSecret"]) {
    check(`the providers reply has no "${forbidden}"`, !keys.includes(forbidden), dump(keys));
  }
  check("brands are returned as id+name only",
    dump(Object.keys(((res.body as { brands: Record<string, unknown>[] }).brands)[0]!).sort()) === dump(["id", "name"]));
  const strings = allStrings(res.body);
  check("the providers reply contains no URL", !strings.some((x) => /^https?:\/\//.test(x)));
}

/* -------------------------------------------------------------------------- */
/* 8. Status — ownership on three axes                                         */
/* -------------------------------------------------------------------------- */

console.log("\n8. Status");

{
  const res = await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, makeDeps());
  const body = res.body as unknown as { id: string; status: string; selectionRequired: boolean };
  check("status is 200 for the owner", res.status === 200);
  check("the DTO carries the flow id", body.id === "flow-1");
  const keys = allKeys(res.body);
  for (const forbidden of ["stateHash", "state", "sessionId", "userId", "tenantId", "accessToken", "refreshToken", "code", "resultRefId"]) {
    check(`the status DTO has no "${forbidden}"`, !keys.includes(forbidden), dump(keys));
  }
}
{
  const foreignUser = makeDeps({ readFlow: async () => flow({ userId: "u2" }) });
  check("a flow belonging to another USER is not_found",
    (await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, foreignUser)).status === 404);
  const foreignTenant = makeDeps({ readFlow: async () => flow({ tenantId: "tenant-b" }) });
  check("a flow belonging to another TENANT is not_found",
    (await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, foreignTenant)).status === 404);
  const otherSession = makeDeps({ readFlow: async () => flow({ sessionId: "sess-OTHER" }) });
  check("a flow from a DIFFERENT login of the same user is not_found",
    (await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, otherSession)).status === 404);
  const missing = makeDeps({ readFlow: async () => null });
  check("a missing flow is not_found",
    (await handleOAuthStatus({ authorization: AUTH, flowId: "nope" }, missing)).status === 404);
  check("a missing and a foreign flow are indistinguishable",
    dump((await handleOAuthStatus({ authorization: AUTH, flowId: "x" }, missing)).body)
    === dump((await handleOAuthStatus({ authorization: AUTH, flowId: "x" }, foreignUser)).body));
}
for (const st of OAUTH_STATUSES) {
  if (st === "expired") continue;
  const d = makeDeps({ readFlow: async () => flow({ status: st }) });
  const res = await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, d);
  const body = res.body as unknown as { status: string; selectionRequired: boolean };
  check(`status "${st}" round-trips`, body.status === st, dump(body));
  check(`selectionRequired matches "${st}"`, body.selectionRequired === (st === "selection_required"));
}
{
  // Reading status repeatedly must be safe and identical.
  const d = makeDeps({ readFlow: async () => flow({ status: "completed", resultAccountId: "acct-x" }) });
  const a = await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, d);
  const b = await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, d);
  check("status is safely re-readable", dump(a.body) === dump(b.body));
  check("a completed flow reports its account", (a.body as { accountId: string }).accountId === "acct-x");
}
{
  const d = makeDeps({ readFlow: async () => flow({ resultCode: "totally-made-up" }) });
  const res = await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, d);
  check("an unrecognized result code is dropped, never forwarded",
    (res.body as { resultCode: string | null }).resultCode === null);
}
for (const c of OAUTH_RESULT_CODES) {
  const d = makeDeps({ readFlow: async () => flow({ status: "failed", resultCode: c }) });
  const res = await handleOAuthStatus({ authorization: AUTH, flowId: "flow-1" }, d);
  check(`result code "${c}" round-trips`, (res.body as { resultCode: string }).resultCode === c);
}

/* -------------------------------------------------------------------------- */
/* 9. Options                                                                  */
/* -------------------------------------------------------------------------- */

console.log("\n9. Options");

{
  const d = makeDeps({ readFlow: async () => flow({ status: "selection_required", resultRefId: "onb-1" }) });
  const res = await handleOAuthOptions({ authorization: AUTH, flowId: "flow-1" }, d);
  const body = res.body as unknown as { options: { id: string }[] };
  check("options are returned while selection is outstanding", res.status === 200 && body.options.length === 2);
  const keys = allKeys(res.body);
  for (const forbidden of ["pageAccessToken", "accessToken", "token", "refreshToken", "secret"]) {
    check(`options carry no "${forbidden}"`, !keys.includes(forbidden), dump(keys));
  }
  check("the option id uses the canonical selection vocabulary",
    body.options.every((o) => /^(facebook|instagram):/.test(o.id)), dump(body.options.map((o) => o.id)));
}
for (const st of ["pending", "provider_pending", "completed", "failed", "cancelled"] as const) {
  const d = makeDeps({ readFlow: async () => flow({ status: st }) });
  const res = await handleOAuthOptions({ authorization: AUTH, flowId: "flow-1" }, d);
  check(`options are refused for status "${st}"`, res.status === 409, dump(res.body));
}
{
  const d = makeDeps({ readFlow: async () => flow({ status: "selection_required", expiresAt: new Date(NOW.getTime() - 1) }) });
  check("options are refused for an expired flow",
    (await handleOAuthOptions({ authorization: AUTH, flowId: "flow-1" }, d)).status === 409);
}
{
  const d = makeDeps({ readFlow: async () => flow({ status: "selection_required", sessionId: "other" }) });
  check("options from a different login are not_found",
    (await handleOAuthOptions({ authorization: AUTH, flowId: "flow-1" }, d)).status === 404);
}

/* -------------------------------------------------------------------------- */
/* 10. Select                                                                  */
/* -------------------------------------------------------------------------- */

console.log("\n10. Select");

const selReady = (over: Partial<OAuthDeps> = {}, s?: Spy) =>
  makeDeps({ readFlow: async () => flow({ status: "selection_required", resultRefId: "onb-1" }), ...over }, s);

{
  const s = spy();
  const res = await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: ["facebook:PAGE_A"] } }, selReady({}, s));
  const body = res.body as unknown as { status: string; connected: number; accountIds: string[] };
  check("a valid selection completes", res.status === 200 && body.status === "completed", dump(res.body));
  check("the canonical service received the selection", dump(s.selections[0]!.selected) === dump(["facebook:PAGE_A"]));
  check("the flow is finalized as completed",
    (s.finalized[0] as { status: string }).status === "completed");
  check("the resulting account is recorded", body.accountIds[0] === "acct-new");
  check("a completion audit is written", s.audits.some((a) => a.event === "oauth.completed"));
  check("the audit carries the mobile surface and no secret",
    s.audits.some((a) => a.metadata.surface === "mobile")
    && !dump(s.audits).toLowerCase().includes("token"));
}
for (const bad of [{}, { selected: "facebook:A" }, { selected: [] }, { selected: [1, 2] }, null]) {
  const res = await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: bad }, selReady());
  check(`a malformed selection ${dump(bad)} is 400`, res.status === 400, dump(res.body));
}
for (const st of ["pending", "provider_pending", "completed", "failed", "cancelled"] as const) {
  const s = spy();
  const res = await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: ["facebook:PAGE_A"] } },
    makeDeps({ readFlow: async () => flow({ status: st }) }, s));
  check(`a selection on a "${st}" flow is 409`, res.status === 409);
  check(`a selection on a "${st}" flow imports nothing`, s.selections.length === 0);
}
{
  // A duplicate submit after completion must not import twice.
  const s = spy();
  const d = selReady({}, s);
  await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: ["facebook:PAGE_A"] } }, d);
  const second = await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: ["facebook:PAGE_A"] } },
    makeDeps({ readFlow: async () => flow({ status: "completed" }) }, s));
  check("a duplicate selection after completion is refused", second.status === 409);
  check("a duplicate selection triggers exactly one import", s.selections.length === 1);
}
{
  // Entitlement outcomes must be reported truthfully, never as success.
  const s = spy();
  const d = selReady({ applySelection: async () => ({ ok: true, connected: 0, monitored: 0, limited: 2, slotTaken: 0, rejected: 0, accountIds: [] }) }, s);
  const res = await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: ["facebook:PAGE_A"] } }, d);
  const body = res.body as unknown as { status: string; resultCode: string };
  check("nothing connected + limit hit reports account_limit_reached",
    body.status === "failed" && body.resultCode === "account_limit_reached", dump(body));
}
{
  const d = selReady({ applySelection: async () => ({ ok: true, connected: 0, monitored: 0, limited: 0, slotTaken: 1, rejected: 0, accountIds: [] }) });
  const body = (await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: ["facebook:PAGE_A"] } }, d)).body as { status: string; resultCode: string };
  check("nothing connected + slot taken reports brand_platform_limit_reached",
    body.status === "failed" && body.resultCode === "brand_platform_limit_reached", dump(body));
}
{
  const d = selReady({ applySelection: async () => ({ ok: true, connected: 0, monitored: 0, limited: 0, slotTaken: 0, rejected: 3, accountIds: [] }) });
  const body = (await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: ["facebook:FORGED"] } }, d)).body as { status: string; resultCode: string; rejected: number };
  check("an entirely forged selection connects nothing", body.status === "failed" && body.resultCode === "no_accounts");
  check("rejections are reported as a COUNT", body.rejected === 3);
}
{
  const s = spy();
  const d = selReady({ applySelection: async () => { throw new Error("vault exploded"); } }, s);
  const res = await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: ["facebook:PAGE_A"] } }, d);
  check("a thrown selection is a generic 500", res.status === 500 && res.body.error === "server_error");
  check("the thrown message never reaches the body", !dump(res.body).includes("vault exploded"));
  check("a thrown selection marks the flow failed",
    (s.finalized[0] as { status: string; resultCode: string }).status === "failed");
}
{
  // A very large body is capped rather than becoming a workload.
  const s = spy();
  const many = Array.from({ length: 500 }, (_, i) => `facebook:P${i}`);
  await handleOAuthSelect({ authorization: AUTH, flowId: "flow-1", body: { selected: many } }, selReady({}, s));
  check("the selection size is bounded", s.selections[0]!.selected.length === 100, String(s.selections[0]!.selected.length));
}

/* -------------------------------------------------------------------------- */
/* 11. Cancel                                                                  */
/* -------------------------------------------------------------------------- */

console.log("\n11. Cancel");

{
  const s = spy();
  const res = await handleOAuthCancel({ authorization: AUTH, flowId: "flow-1" }, makeDeps({}, s));
  check("cancel is 200", res.status === 200);
  check("cancel finalizes as cancelled with a bounded code",
    (s.finalized[0] as { status: string; resultCode: string }).status === "cancelled"
    && (s.finalized[0] as { resultCode: string }).resultCode === "user_cancelled");
}
{
  // Cancelling an already-completed flow reports the SERVER's truth, not the request.
  const d = makeDeps({ readFlow: async () => flow({ status: "completed" }), finalizeFlow: async () => false });
  const res = await handleOAuthCancel({ authorization: AUTH, flowId: "flow-1" }, d);
  check("cancelling a completed flow still reports completed",
    (res.body as { status: string }).status === "completed", dump(res.body));
}
{
  const repo = repoCodeOf("packages/db/src/connector-oauth-flow.ts");
  check("finalize only matches a NON-terminal flow — a late callback cannot resurrect it",
    /finalizeConnectorOAuthFlow[\s\S]{0,600}status: \{ notIn: \[\.\.\.TERMINAL\] \}/.test(repo));
  check("terminal states are the four real ones",
    /TERMINAL: readonly OAuthFlowStatus\[\] = \["completed", "failed", "cancelled", "expired"\]/.test(repo));
  check("isTerminalFlowStatus agrees",
    isTerminalFlowStatus("completed") && isTerminalFlowStatus("cancelled")
    && !isTerminalFlowStatus("selection_required") && !isTerminalFlowStatus("pending"));
  check("the DB and service status vocabularies agree",
    dump([...OAUTH_FLOW_STATUSES].sort()) === dump([...OAUTH_STATUSES].sort()));
}

/* -------------------------------------------------------------------------- */
/* 12. Callback: state resolution, ordering and the deep link                  */
/* -------------------------------------------------------------------------- */

console.log("\n12. Callbacks");

for (const cb of CALLBACKS) {
  const src = codeOf(cb);
  check(`${cb}: the mobile branch is tried BEFORE any cookie read`,
    src.indexOf("tryResolveMobileFlow") > 0
    && src.indexOf("tryResolveMobileFlow") < src.indexOf("getSession()"),
    `mobile=${src.indexOf("tryResolveMobileFlow")} session=${src.indexOf("getSession()")}`);
  check(`${cb}: the web branch still requires a session`, /getSession\(\)/.test(src) && /\/login/.test(src));
  check(`${cb}: the mobile deep link carries ONLY a flow id`,
    /mobileCallbackUrl\((?:flow\.id|mobile\.flowId)\)/.test(src));
  check(`${cb}: no provider code reaches the deep link`, !/mobileCallbackUrl\([^)]*code/.test(src));
  check(`${cb}: no provider state reaches the deep link`, !/mobileCallbackUrl\([^)]*state/.test(src));
  check(`${cb}: no token reaches the deep link`, !/mobileCallbackUrl\([^)]*[Tt]oken/.test(src));
  check(`${cb}: no success flag is encoded in the deep link`, !/mobileCallbackUrl\([^)]*success/.test(src));
  check(`${cb}: the provider redirect URI is never tamanor://`, !/redirect_uri[^\n]*tamanor:\/\//.test(src));
}
{
  const mc = codeOf("src/server/oauth/mobile-callback.ts");
  check("the deep link is exactly scheme + path + flow", /return `\$\{MOBILE_SCHEME\}:\/\/oauth\/callback\?flow=\$\{encodeURIComponent\(flowId\)\}`/.test(mc));
  check("the scheme matches the app", /MOBILE_SCHEME = "tamanor"/.test(mc));
  check("a provider mismatch is rejected", /flow\.provider !== input\.provider/.test(mc));
  check("a non-mobile surface falls through to the web path", /flow\.surface !== "mobile"/.test(mc));
  check("the originating session is re-validated at the callback", /originatingSessionIsValid\(flow\.sessionId/.test(mc));
  check("identity comes from the STORED flow, never the browser",
    /userId: flow\.userId/.test(mc) && /tenantId: flow\.tenantId/.test(mc)
    && !/searchParams\.get\("tenantId"\)/.test(mc) && !/searchParams\.get\("userId"\)/.test(mc));
  const repo = repoCodeOf("packages/db/src/connector-oauth-flow.ts");
  check("session validity checks revocation and both expiries",
    /revokedAt/.test(repo) && /expiresAt\.getTime\(\) <= now/.test(repo) && /absoluteExpiresAt/.test(repo));
}
{
  // Both callbacks run the SAME provider pipeline — no duplicated engine.
  const metaCb = codeOf("src/app/api/connectors/meta/callback/route.ts");
  check("the Meta callback calls the shared exchange exactly twice (one per branch)",
    (metaCb.match(/runMetaOAuthExchange\(\{/g) ?? []).length === 2);
  check("the Meta callback contains no inline token exchange",
    !/exchangeMetaCode\(/.test(metaCb) && !/discoverMetaAccounts\(/.test(metaCb));
  const svc = codeOf("src/server/oauth/meta-oauth-service.ts");
  check("the shared exchange owns the provider pipeline",
    /exchangeMetaCode\(/.test(svc) && /exchangeForLongLivedToken\(/.test(svc) && /discoverMetaAccounts\(/.test(svc));
  check("the shared exchange returns no token", !/return \{ ok: true[^}]*[Tt]oken/.test(svc));
  check("the Meta mobile branch never claims connected — it marks selection_required",
    /markSelectionRequired\(\{ flow, resultRefId: result\.onboardingId \}\)/.test(metaCb));
  const gbCb = codeOf("src/app/api/connectors/google-business/callback/route.ts");
  check("the Google mobile branch marks selection_required, not completed",
    /markSelectionRequired\(/.test(gbCb) && !/status: "completed"/.test(gbCb));
  check("the Google mobile branch promotes the connection LAST",
    gbCb.lastIndexOf("activateGoogleBusinessConnection") > gbCb.lastIndexOf("discoverGoogleBusinessScope"));
}

/* -------------------------------------------------------------------------- */
/* 13. Secrets, logging and the provider-write boundary                        */
/* -------------------------------------------------------------------------- */

console.log("\n13. Secrets and boundaries");

for (const m of OAUTH_MODULES) {
  const src = codeOf(m);
  // The shared Meta exchange keeps the ORIGINAL callback's structured, token-free
  // diagnostic — removing it would lose production debuggability that predates M7.
  // Its content is asserted separately below.
  if (m !== "src/server/oauth/meta-oauth-service.ts") {
    check(`${m} never logs`, !/console\.(log|warn|error|info|debug)/.test(src));
  }
  check(`${m} embeds no bearer literal`, !/Bearer\s[A-Za-z0-9]/.test(src));
}
check("the shared exchange logs ONLY through the structured token-free helper",
  (codeOf("src/server/oauth/meta-oauth-service.ts").match(/console\./g) ?? []).length === 1);
{
  // The shared exchange is allowed ONE structured, token-free diagnostic.
  const svc = codeOf("src/server/oauth/meta-oauth-service.ts");
  check("the exchange's diagnostics never include a token or a code",
    /logDiag/.test(svc)
    && !/logDiag\([^)]*accessToken/.test(svc)
    && !/logDiag\([^)]*\bcode\b/.test(svc));
}
{
  const all = OAUTH_MODULES.map(codeOf).join("\n");
  for (const forbidden of ["hideComment", "deleteComment", "replyToComment", "attemptFacebookHide", "executeLiveHide"]) {
    check(`no OAuth module performs moderation: ${forbidden}`, !all.includes(forbidden));
  }
  check("no OAuth module reads a provider client secret directly",
    !/process\.env\.META_APP_SECRET|process\.env\.GOOGLE_BUSINESS_CLIENT_SECRET/.test(all));
}
{
  // The DTO surface cannot express a credential.
  const svc = codeOf("src/server/mobile-oauth.ts");
  const dtoBlock = svc.slice(svc.indexOf("Wire DTOs"), svc.indexOf("Dependencies"));
  for (const forbidden of ["accessToken", "refreshToken", "clientSecret", "stateHash", "sessionId", "tenantId", "userId"]) {
    check(`no wire DTO declares "${forbidden}"`, !dtoBlock.includes(forbidden), forbidden);
  }
}

/* -------------------------------------------------------------------------- */
/* 14. Route hygiene                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n14. Route hygiene");

const ROUTES = OAUTH_MODULES.filter((m) => m.includes("/api/"));
for (const r of ROUTES) {
  const src = codeOf(r);
  check(`${r} is no-store`, src.includes('"Cache-Control": "no-store"'));
  check(`${r} is nodejs + force-dynamic`, src.includes('runtime = "nodejs"') && src.includes('dynamic = "force-dynamic"'));
  check(`${r} reads the bearer from the header`, src.includes('req.headers.get("authorization")'));
  check(`${r} never redirects`, !/NextResponse\.redirect/.test(src));
  check(`${r} sets no cookie`, !/cookies\(\)/.test(src));
}
check("start is POST-only", /export async function POST/.test(codeOf("src/app/api/mobile/oauth/start/route.ts")) && !/export async function GET/.test(codeOf("src/app/api/mobile/oauth/start/route.ts")));
check("status is GET-only", /export async function GET/.test(codeOf("src/app/api/mobile/oauth/flows/[flowId]/route.ts")) && !/export async function POST/.test(codeOf("src/app/api/mobile/oauth/flows/[flowId]/route.ts")));
for (const m of ["select", "cancel"]) {
  const src = codeOf(`src/app/api/mobile/oauth/flows/[flowId]/${m}/route.ts`);
  check(`${m} is POST-only`, /export async function POST/.test(src) && !/export async function GET/.test(src));
}

/* -------------------------------------------------------------------------- */
/* 15. Vocabularies                                                            */
/* -------------------------------------------------------------------------- */

console.log("\n15. Vocabularies");

check("providers are exactly meta + google_business", dump(OAUTH_PROVIDERS) === dump(["meta", "google_business"]));
check("intents are exactly connect + reconnect", dump(OAUTH_INTENTS) === dump(["connect", "reconnect"]));
check("selection_required is a first-class status", (OAUTH_STATUSES as readonly string[]).includes("selection_required"));
check("there is no status that conflates authorized with connected",
  !(OAUTH_STATUSES as readonly string[]).includes("authorized"));
for (const c of ["user_cancelled", "invalid_state", "expired", "account_limit_reached", "brand_platform_limit_reached", "token_exchange_failed", "no_accounts", "save_failed"]) {
  check(`the bounded vocabulary includes "${c}"`, (OAUTH_RESULT_CODES as readonly string[]).includes(c));
}
{
  const dto = toFlowDto(flow({ provider: "banana", intent: "banana" }), NOW);
  check("an unknown provider degrades to a bounded key", dto.provider === "meta");
  check("an unknown intent degrades to a bounded key", dto.intent === "connect");
}

/* -------------------------------------------------------------------------- */

console.log(
  `\n${fail === 0 ? "PASS" : "FAIL"} — mobile connector OAuth (M7): ${pass} passed, ${fail} failed`,
);
process.exit(fail === 0 ? 0 : 1);
