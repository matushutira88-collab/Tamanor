/**
 * META-EXTERNAL-ACCESS-V2 — credential authorization provenance + callback revocation.
 *
 * These are PURE tests over an in-memory model of the exact queries `revokeMetaAuthorization` issues, plus
 * source invariants over the real implementation. They need NO database and NO Meta call, so they run in this
 * environment; the real function is additionally pinned by source assertions so the model cannot drift from it
 * silently.
 *
 * Proves: a callback invalidates every credential CURRENTLY authorised by the requesting identity and the
 * accounts owning them, leaves every other tenant / account / identity untouched, survives a credential
 * replaced by a second authoriser, is idempotent and replay-safe, and never leaks an id or secret.
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");

const USER_A = "FBUSER_AAA";
const USER_B = "FBUSER_BBB";
const UNKNOWN = "FBUSER_NEVER_SEEN";

// ---- in-memory model of the three tables the callback touches ---------------------------------------------
interface Cred { id: string; tenantId: string; provider: string; connectedAccountId: string | null; authorizingProviderUserId: string | null; revokedAt: Date | null }
interface Acct { id: string; tenantId: string; platform: string; status: string; connectionStatus: string; tokenHealth: string; requiresReconnectReason: string | null }
interface Link { provider: string; providerAccountId: string }
interface World { creds: Cred[]; accts: Acct[]; links: Link[] }

/** Mirrors revokeMetaAuthorization exactly: revoke attributable creds → downgrade accounts → drop link. */
function revoke(w: World, providerUserId: string, now = new Date("2026-08-03T10:00:00Z")) {
  const id = providerUserId.trim();
  if (!id) return { credentialsRevoked: 0, accountsInvalidated: 0, loginLinkRemoved: false, alreadyClean: true };
  const target = w.creds.filter((c) => c.provider === "meta" && c.authorizingProviderUserId === id && c.revokedAt === null);
  for (const c of target) c.revokedAt = now;
  const acctIds = [...new Set(target.map((c) => c.connectedAccountId).filter((v): v is string => Boolean(v)))];
  let accountsInvalidated = 0;
  for (const a of w.accts) {
    if (!acctIds.includes(a.id) || a.status === "disconnected") continue;
    a.connectionStatus = "needs_reconnect"; a.tokenHealth = "revoked"; a.requiresReconnectReason = "provider_deauthorized";
    accountsInvalidated++;
  }
  const before = w.links.length;
  w.links = w.links.filter((l) => !(l.provider === "facebook" && l.providerAccountId === id));
  const loginLinkRemoved = w.links.length < before;
  return {
    credentialsRevoked: target.length, accountsInvalidated, loginLinkRemoved,
    alreadyClean: target.length === 0 && accountsInvalidated === 0 && !loginLinkRemoved,
  };
}

/** Mirrors resolveMetaAccessToken's vault-first, fail-closed rule for one account. */
function resolveToken(w: World, accountId: string): "usable" | "revoked" | "absent" {
  const rows = w.creds.filter((c) => c.connectedAccountId === accountId && c.provider === "meta");
  if (rows.some((c) => c.revokedAt === null)) return "usable";
  // A row that EXISTS but is revoked fails closed — it is never downgraded to a legacy column read.
  return rows.length > 0 ? "revoked" : "absent";
}

const acct = (o: Partial<Acct> & { id: string; tenantId: string }): Acct => ({
  platform: "facebook_page", status: "active", connectionStatus: "connected", tokenHealth: "ok", requiresReconnectReason: null, ...o,
});
const cred = (o: Partial<Cred> & { id: string; tenantId: string; connectedAccountId: string }): Cred => ({
  provider: "meta", authorizingProviderUserId: USER_A, revokedAt: null, ...o,
});

function world(): World {
  return {
    accts: [
      acct({ id: "t1-page", tenantId: "t1" }),
      acct({ id: "t1-ig", tenantId: "t1", platform: "instagram_business" }),
      acct({ id: "t1-page-other-user", tenantId: "t1" }),
      acct({ id: "t2-page", tenantId: "t2" }),
      acct({ id: "t1-legacy", tenantId: "t1" }),
    ],
    creds: [
      cred({ id: "c-page", tenantId: "t1", connectedAccountId: "t1-page", authorizingProviderUserId: USER_A }),
      cred({ id: "c-ig", tenantId: "t1", connectedAccountId: "t1-ig", authorizingProviderUserId: USER_A }),
      cred({ id: "c-other", tenantId: "t1", connectedAccountId: "t1-page-other-user", authorizingProviderUserId: USER_B }),
      cred({ id: "c-t2", tenantId: "t2", connectedAccountId: "t2-page", authorizingProviderUserId: USER_B }),
      cred({ id: "c-legacy", tenantId: "t1", connectedAccountId: "t1-legacy", authorizingProviderUserId: null }),
    ],
    links: [{ provider: "facebook", providerAccountId: USER_A }, { provider: "facebook", providerAccountId: USER_B }],
  };
}
const acctOf = (w: World, id: string) => w.accts.find((a) => a.id === id)!;
const credOf = (w: World, id: string) => w.creds.find((c) => c.id === id)!;

console.log("\n1) deauthorization / deletion clear the credentials that identity authorised");
{
  const w = world();
  const r = revoke(w, USER_A);
  check("1a) every credential currently authorised by the requester is revoked",
    credOf(w, "c-page").revokedAt !== null && credOf(w, "c-ig").revokedAt !== null && r.credentialsRevoked === 2);
  check("1b) resolveMetaAccessToken can no longer return the Page credential", resolveToken(w, "t1-page") === "revoked");
  check("1c) the affected Page is reconnect-required",
    acctOf(w, "t1-page").connectionStatus === "needs_reconnect" && acctOf(w, "t1-page").tokenHealth === "revoked"
    && acctOf(w, "t1-page").requiresReconnectReason === "provider_deauthorized");
  check("1d) the affected Instagram account is reconnect-required",
    acctOf(w, "t1-ig").connectionStatus === "needs_reconnect" && acctOf(w, "t1-ig").tokenHealth === "revoked");
  check("1e) MULTIPLE credentials owned by the requester are all invalidated", r.accountsInvalidated === 2);
  check("1f) the login link is removed", r.loginLinkRemoved && !w.links.some((l) => l.providerAccountId === USER_A));
  check("1g) comment sync / moderation / Lead Ads can no longer use them",
    resolveToken(w, "t1-page") !== "usable" && resolveToken(w, "t1-ig") !== "usable");
}

console.log("\n2) unrelated data is preserved");
{
  const w = world();
  revoke(w, USER_A);
  check("2a) another tenant is completely unchanged",
    credOf(w, "c-t2").revokedAt === null && acctOf(w, "t2-page").connectionStatus === "connected" && resolveToken(w, "t2-page") === "usable");
  check("2b) an account in the SAME tenant authorised by another Meta user is unchanged",
    credOf(w, "c-other").revokedAt === null && acctOf(w, "t1-page-other-user").connectionStatus === "connected");
  check("2c) the other identity's login link survives", w.links.some((l) => l.providerAccountId === USER_B));
  check("2d) a credential with NO provenance is never swept up (not attributable to anyone)",
    credOf(w, "c-legacy").revokedAt === null && acctOf(w, "t1-legacy").connectionStatus === "connected");
  check("2e) connected account ROWS are kept (config/history preserved), only made unusable",
    w.accts.length === 5 && acctOf(w, "t1-page").status === "active");
}

console.log("\n3) provenance replacement — a newer authoriser wins");
{
  const w = world();
  // USER_B reconnects the Page: storeProviderCredential rotates the row and REPLACES its provenance.
  credOf(w, "c-page").authorizingProviderUserId = USER_B;
  const r = revoke(w, USER_A); // a LATER callback from the original authoriser
  check("3a) the replaced credential survives the old user's deauthorization", credOf(w, "c-page").revokedAt === null);
  check("3b) the Page stays usable", resolveToken(w, "t1-page") === "usable" && acctOf(w, "t1-page").connectionStatus === "connected");
  check("3c) only the still-attributable credential is revoked", r.credentialsRevoked === 1 && credOf(w, "c-ig").revokedAt !== null);
  check("3d) a later callback from the NEW authoriser does revoke it", (() => {
    const r2 = revoke(w, USER_B);
    return credOf(w, "c-page").revokedAt !== null && r2.credentialsRevoked >= 1;
  })());
}

console.log("\n4) idempotent and replay-safe");
{
  const w = world();
  const first = revoke(w, USER_A);
  const second = revoke(w, USER_A);
  check("4a) the repeated callback changes nothing further",
    second.credentialsRevoked === 0 && second.accountsInvalidated === 0 && second.loginLinkRemoved === false);
  check("4b) the repeat reports alreadyClean", second.alreadyClean === true && first.alreadyClean === false);
  check("4c) revocation timestamps are not overwritten by the replay",
    credOf(w, "c-page").revokedAt?.toISOString() === "2026-08-03T10:00:00.000Z");
  const unknown = revoke(world(), UNKNOWN);
  check("4d) an unknown provider user changes nothing and reports alreadyClean",
    unknown.credentialsRevoked === 0 && unknown.accountsInvalidated === 0 && unknown.alreadyClean === true);
  const blank = revoke(world(), "   ");
  check("4e) a blank id is a no-op", blank.alreadyClean === true && blank.credentialsRevoked === 0);
}

console.log("\n5) results leak nothing");
{
  const w = world();
  const r = revoke(w, USER_A);
  const dump = JSON.stringify(r);
  check("5a) the result carries no provider user id, account id, tenant id or token",
    !dump.includes(USER_A) && !dump.includes("t1-page") && !dump.includes("t1") && !/token|cipher/i.test(dump), dump);
  check("5b) the result is counts + booleans only",
    Object.keys(r).sort().join(",") === "accountsInvalidated,alreadyClean,credentialsRevoked,loginLinkRemoved");
}

console.log("\n6) source invariants — the real implementation matches this model");
{
  const src = read("packages/db/src/meta-identity-deletion.ts");
  check("6a) selects only ACTIVE credentials with matching provenance",
    /authorizingProviderUserId: id/.test(src) && /revokedAt: null/.test(src) && /provider: BusinessProvider\.meta/.test(src));
  check("6b) revokes by setting revokedAt (never deletes the credential row)",
    /providerCredential\.updateMany/.test(src) && !/providerCredential\.delete/.test(src));
  check("6c) downgrades the owning accounts to needs_reconnect", /connectionStatus: "needs_reconnect"/.test(src) && /tokenHealth: "revoked"/.test(src));
  check("6d) never deletes tenants, users, contacts, comments or connected accounts",
    !/\b(tenant|user|businessContact|reputationItem|connectedAccount)\.(delete|deleteMany)/i.test(src));
  check("6e) the login link is dropped ONLY AFTER credentials are invalidated",
    src.indexOf("providerCredential.updateMany") < src.indexOf("oAuthAccount.deleteMany")
    && src.indexOf("connectedAccount.updateMany") < src.indexOf("oAuthAccount.deleteMany"));
  check("6f) a disconnected row is never resurrected", /status: \{ not: "disconnected"/.test(src));
  check("6g) returns counts only — no ids", !/return \{[\s\S]*?(accountId|tenantId|providerUserId)/.test(src.slice(src.lastIndexOf("return {"))));

  const vault = read("packages/db/src/provider-credential-vault.ts");
  check("6h) provenance is written on every store/rotate", /authorizingProviderUserId: input\.authorizingProviderUserId \?\? null/.test(vault));
  const resolver = read("packages/db/src/provider-credential-resolver.ts");
  check("6i) a revoked vault row fails closed and is never downgraded to a legacy read",
    /if \(outcome\.state === "revoked"\) throw new VaultCredentialUnusableError\("revoked"\)/.test(resolver));

  const cb = read("apps/web/src/app/api/connectors/meta/callback/route.ts");
  check("6j) the authorizing user id is resolved SERVER-SIDE from Graph, never from the browser",
    /fetchMetaAuthorizingUserId\(token\.accessToken/.test(cb) && !/searchParams\.get\("user_id"\)/.test(cb) && !/formData/.test(cb));
  const confirm = read("apps/web/src/app/dashboard/accounts/meta/actions.ts");
  check("6k) connect passes provenance from the server-held onboarding row",
    /authorizingProviderUserId: row\.authorizingProviderUserId/.test(confirm));
  check("6l) provenance is never read from the submitted form", !/get\("authorizingProviderUserId"\)/.test(confirm) && !/get\("user_id"\)/.test(confirm));

  for (const route of ["apps/web/src/app/api/meta/data-deletion/route.ts", "apps/web/src/app/api/meta/deauthorize/route.ts"]) {
    const r = read(route);
    const name = route.includes("deauthorize") ? "deauthorize" : "data-deletion";
    // Compare CALL SITES, not imports or doc comments.
    const verifyCall = r.indexOf("= verifyMetaSignedRequest(");
    const revokeCall = r.indexOf("await revokeMetaAuthorization(verified.userId)");
    const reject400 = r.indexOf('{ error: "invalid_request" }, { status: 400 }');
    check(`6m) ${name}: verification precedes revocation`, verifyCall > 0 && revokeCall > verifyCall, `verify=${verifyCall} revoke=${revokeCall}`);
    check(`6n) ${name}: an invalid signed_request returns 400 before any DB mutation`,
      /if \(!verified\.ok\)/.test(r) && reject400 > 0 && reject400 < revokeCall, `400=${reject400} revoke=${revokeCall}`);
    check(`6o) ${name}: emits no count and no user id`,
      !/verified\.userId[^)]*emitOpsEvent/.test(r) && !/credentialsRevoked/.test(r) && !/accountsInvalidated/.test(r));
  }
  const del = read("apps/web/src/app/api/meta/data-deletion/route.ts");
  check("6p) data-deletion still returns Meta's bounded contract", /confirmation_code: confirmationCode/.test(del) && /url: abs\(/.test(del));
  check("6q) data-deletion performs at least the same invalidation as deauthorization", /revokeMetaAuthorization\(verified\.userId\)/.test(del));

  const migration = read("packages/db/prisma/migrations/20260829090000_meta_credential_authorization_provenance/migration.sql");
  check("6r) the migration is additive and idempotent",
    /ADD COLUMN IF NOT EXISTS/.test(migration) && !/DROP /i.test(migration) && !/UPDATE /i.test(migration));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta authorization revocation: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
