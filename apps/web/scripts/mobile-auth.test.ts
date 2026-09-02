/**
 * M2 — native mobile auth API: login / session / logout.
 *
 * PURE tests: the service and the shared credential core take every dependency by
 * injection, so this suite runs with fakes — no database, no Next, no network, no
 * Argon2. It asserts the SECURITY contract, not the plumbing:
 *   - enumeration-safety (missing account and wrong password are indistinguishable,
 *     and the missing-account path still performs the dummy verify),
 *   - the hard rate limits and the adaptive bot challenge are preserved and cannot
 *     be bypassed by anything a mobile client sends,
 *   - session validation is authoritative and fails closed on every reject reason,
 *   - nothing the client sends is ever treated as identity or tenant truth,
 *   - no password, hash, or token leaks into an error body.
 *
 * Run: pnpm mobile-auth:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ResolvedSession, SessionRejectReason } from "@guardora/db";
import { authenticateCredentials, type CredentialDeps } from "../src/server/login-core";
import {
  handleMobileLogin, handleMobileSession, handleMobileLogout,
  bearerToken, mapRejectReason,
  type MobileAuthDeps, type MobileWorkspace,
} from "../src/server/mobile-auth";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

const DUMMY = "$argon2id$v=19$m=19456,t=2,p=1$DUMMYSALT$DUMMYHASH";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** Read a repo-relative source file, for the anti-drift assertions at the end. */
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

const limiter = (allowed: boolean) => ({ check: async () => ({ allowed }) });
/** Allows the first N checks, then blocks — models a real sliding window. */
const limiterAfter = (n: number) => {
  let seen = 0;
  return { check: async () => ({ allowed: seen++ < n }) };
};

function session(over: Partial<ResolvedSession> = {}): ResolvedSession {
  return {
    sessionId: "sess_1", userId: "user_1", userName: "Ada", userEmail: "ada@tamanor.test",
    emailVerified: true, tenantId: "tenant_1", tenantName: "Acme", workspaceKind: "business",
    role: "owner", expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    absoluteExpiresAt: new Date("2030-01-01T00:00:00.000Z"), rememberMe: false,
    ...over,
  };
}

interface Recorder {
  verifyArgs: Array<{ hash: string | null | undefined; plaintext: string }>;
  created: Array<{ userId: string; rememberMe?: boolean; userAgentSummary?: string }>;
  revoked: string[];
  events: Array<{ event: string; meta?: Record<string, unknown> }>;
  metrics: Array<{ name: string; labels?: Record<string, string> }>;
  notified: Array<{ email: string; device: string | null }>;
}

function makeDeps(opts: {
  user?: { id: string; passwordHash: string | null } | null;
  passwordOk?: boolean;
  authAllowed?: boolean | { check: () => Promise<{ allowed: boolean }> };
  challengeAllowed?: boolean;
  turnstileEnabled?: boolean;
  challengeVerifies?: boolean;
  sessionOverride?: Partial<ResolvedSession>;
  token?: string;
  readResult?: { ok: boolean; session?: ResolvedSession; reason?: SessionRejectReason };
  createThrows?: boolean;
  workspace?: MobileWorkspace;
  notifyThrows?: boolean;
} = {}): { deps: MobileAuthDeps; rec: Recorder } {
  const rec: Recorder = { verifyArgs: [], created: [], revoked: [], events: [], metrics: [], notified: [] };

  const credentialDeps: CredentialDeps = {
    authLimiter: typeof opts.authAllowed === "object" ? opts.authAllowed : limiter(opts.authAllowed ?? true),
    challengeLimiter: limiter(opts.challengeAllowed ?? true),
    turnstileEnabled: () => opts.turnstileEnabled ?? false,
    verifyChallenge: async () => ({ ok: opts.challengeVerifies ?? false, reason: "invalid-input-response" }),
    normalizeEmail: (e) => e.trim().toLowerCase(),
    findUserForLogin: async () => (opts.user === undefined ? { id: "user_1", passwordHash: "$argon2id$real" } : opts.user),
    verifyPassword: async (hash, plaintext) => {
      rec.verifyArgs.push({ hash, plaintext });
      return hash === DUMMY ? false : (opts.passwordOk ?? true);
    },
    dummyPasswordHash: DUMMY,
    metrics: { inc: (name, labels) => rec.metrics.push({ name, labels }) },
    emitOpsEvent: (event, meta) => rec.events.push({ event, meta }),
  };

  const deps: MobileAuthDeps = {
    authenticateCredentials,
    credentialDeps,
    createUserSession: async (input) => {
      if (opts.createThrows) throw new Error("createUserSession: no valid tenant membership");
      rec.created.push(input);
      return {
        token: opts.token ?? "MFhZ0oGq7s3nB2wKpLd8vQ1cRt5uJe4aZx6yNm9bTgE",
        session: session({ rememberMe: input.rememberMe ?? false, ...opts.sessionOverride }),
      };
    },
    readUserSession: async () => opts.readResult ?? { ok: true, session: session(opts.sessionOverride) },
    revokeUserSession: async (t) => { rec.revoked.push(t ?? "<null>"); },
    classifyWorkspace: (kind) => opts.workspace ?? (kind === "business" ? "business" : kind === "family" ? "family" : "unsupported"),
    summarizeUserAgent: (ua) => (ua ? "Browser · iOS" : null),
    notifyNewLogin: async (email, device) => {
      if (opts.notifyThrows) throw new Error("smtp down");
      rec.notified.push({ email, device });
    },
    metrics: { inc: (name, labels) => rec.metrics.push({ name, labels }) },
    emitOpsEvent: (event, meta) => rec.events.push({ event, meta }),
  };
  return { deps, rec };
}

const loginReq = (body: unknown) => ({ body, ipKey: "ip_abc", remoteIp: "203.0.113.9", userAgent: "Tamanor/1.0 iOS" });

/** Serialized body, for leakage assertions. */
const dump = (o: unknown) => JSON.stringify(o);

async function run() {
  /* ===================== LOGIN ===================== */
  console.log("\nLOGIN");

  {
    const { deps, rec } = makeDeps();
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "correct-horse" }), deps);
    check("valid credentials → 200 + token issued", res.status === 200 && typeof res.body.token === "string" && (res.body.token as string).length > 20);
    check("valid login creates a standard UserSession", rec.created.length === 1 && rec.created[0]!.userId === "user_1");
    check("session view returned alongside the token", typeof res.body.session === "object" && res.body.session !== null);
    check("success metric is bounded", rec.metrics.some((m) => m.name === "auth_login_total" && m.labels?.result === "ok"));
    check("success ops event is bounded", rec.events.some((e) => e.event === "auth.login_succeeded"));
  }

  {
    const { deps } = makeDeps({ passwordOk: false });
    const wrong = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "nope" }), deps);
    const { deps: d2 } = makeDeps({ user: null });
    const missing = await handleMobileLogin(loginReq({ email: "nobody@tamanor.test", password: "nope" }), d2);
    check("wrong password → 401 invalid_credentials", wrong.status === 401 && wrong.body.error === "invalid_credentials");
    check("missing account → 401 invalid_credentials", missing.status === 401 && missing.body.error === "invalid_credentials");
    check("missing account and wrong password are INDISTINGUISHABLE", dump(wrong) === dump(missing));
  }

  {
    const { deps, rec } = makeDeps({ user: null });
    await handleMobileLogin(loginReq({ email: "nobody@tamanor.test", password: "pw" }), deps);
    check("missing account STILL performs the dummy Argon2 verify", rec.verifyArgs.length === 1 && rec.verifyArgs[0]!.hash === DUMMY);
  }
  {
    const { deps, rec } = makeDeps({ user: { id: "u", passwordHash: null } });
    await handleMobileLogin(loginReq({ email: "oauth@tamanor.test", password: "pw" }), deps);
    check("account without a local password also runs the dummy verify", rec.verifyArgs.length === 1 && rec.verifyArgs[0]!.hash === DUMMY);
  }

  for (const [label, body] of [
    ["not-an-email", { email: "nope", password: "pw" }],
    ["empty email", { email: "", password: "pw" }],
    ["empty password", { email: "a@b.co", password: "" }],
    ["missing fields", {}],
    ["array body", []],
    ["null body", null],
    ["non-string email", { email: 123, password: "pw" }],
  ] as const) {
    const { deps, rec } = makeDeps();
    const res = await handleMobileLogin(loginReq(body), deps);
    check(`malformed input rejected (${label})`, res.status === 400 || res.status === 401);
    check(`malformed input (${label}) never mints a session`, rec.created.length === 0);
  }

  {
    const { deps, rec } = makeDeps();
    const long = "a".repeat(400) + "@tamanor.test";
    const res = await handleMobileLogin(loginReq({ email: long, password: "pw" }), deps);
    check("over-long email rejected before any Argon2 work", res.status === 401 && rec.verifyArgs.length === 0);
  }
  {
    const { deps, rec } = makeDeps();
    const res = await handleMobileLogin(loginReq({ email: "a@b.co", password: "p".repeat(5000) }), deps);
    check("over-long password rejected before any Argon2 work", res.status === 401 && rec.verifyArgs.length === 0);
  }

  {
    const { deps, rec } = makeDeps({ authAllowed: false });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    check("per-IP rate limit preserved → 429 rate_limited", res.status === 429 && res.body.error === "rate_limited");
    check("rate-limited attempt never mints a session", rec.created.length === 0);
    check("rate-limit metric emitted", rec.metrics.some((m) => m.name === "auth_rate_limited_total"));
  }
  {
    // First check (per-IP) allowed, second (per-email) blocked.
    const { deps, rec } = makeDeps({ authAllowed: limiterAfter(1) });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    check("per-EMAIL rate limit preserved → 429", res.status === 429 && res.body.error === "rate_limited");
    check("per-email rate limit blocks before credential work", rec.verifyArgs.length === 0);
  }

  /* --------------------- adaptive bot challenge --------------------- */
  {
    const { deps, rec } = makeDeps({ turnstileEnabled: true, challengeAllowed: false, challengeVerifies: false });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    check("challenge required + not solved → 401 challenge_required (FAIL CLOSED)", res.status === 401 && res.body.error === "challenge_required");
    check("challenge failure never mints a session", rec.created.length === 0);
    check("challenge failure never runs credential verification", rec.verifyArgs.length === 0);
    check("challenge block is audited", rec.events.some((e) => e.event === "auth.login_blocked"));
  }
  {
    const { deps } = makeDeps({ turnstileEnabled: true, challengeAllowed: false, challengeVerifies: true });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw", challengeToken: "cf-token" }), deps);
    check("challenge required + solved → login proceeds", res.status === 200);
  }
  // The client cannot opt out of the challenge by ANY payload it controls.
  for (const extra of [
    { skipChallenge: true }, { challenge: "bypass" }, { isMobile: true }, { platform: "ios" },
    { trusted: true }, { turnstile: null }, { challengeRequired: false }, { bypassToken: "x" },
  ]) {
    const { deps } = makeDeps({ turnstileEnabled: true, challengeAllowed: false, challengeVerifies: false });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw", ...extra }), deps);
    check(`challenge NOT bypassable via client field ${dump(extra)}`, res.status === 401 && res.body.error === "challenge_required");
  }
  {
    // No provider configured: the attempt is audited but NEVER treated as verified —
    // and the hard rate limiter remains the independent brute-force gate.
    const { deps, rec } = makeDeps({ turnstileEnabled: false, challengeAllowed: false });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    check("no challenge provider → audited as bot_challenge", rec.events.some((e) => e.event === "auth.bot_challenge"));
    check("no challenge provider → still no bypass claim, login evaluated normally", res.status === 200);
  }

  /* --------------------- remember-me + verification --------------------- */
  {
    const { deps, rec } = makeDeps();
    await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw", rememberMe: true }), deps);
    check("rememberMe:true is passed through to session creation", rec.created[0]!.rememberMe === true);
  }
  {
    const { deps, rec } = makeDeps();
    await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    check("rememberMe defaults to false", rec.created[0]!.rememberMe === false);
  }
  for (const truthy of ["true", 1, "on", "yes"]) {
    const { deps, rec } = makeDeps();
    await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw", rememberMe: truthy }), deps);
    check(`rememberMe only honours a real boolean (${dump(truthy)} → false)`, rec.created[0]!.rememberMe === false);
  }

  {
    const { deps } = makeDeps({ sessionOverride: { emailVerified: false } });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    const view = res.body.session as Record<string, unknown>;
    check("unverified email still issues a session (parity with web)", res.status === 200 && typeof res.body.token === "string");
    check("unverified email state is preserved in the response", view.emailVerified === false);
  }
  {
    const { deps } = makeDeps({ createThrows: true });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    check("no valid membership → generic 401 (never the internal reason)", res.status === 401 && res.body.error === "invalid_credentials");
    check("membership failure leaks no internal detail", !dump(res).includes("membership") && !dump(res).includes("tenant"));
  }
  {
    const { deps } = makeDeps({ notifyThrows: true });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    check("security-email failure never blocks login", res.status === 200);
  }
  {
    const { deps, rec } = makeDeps();
    await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "pw" }), deps);
    check("device label is derived server-side from the UA", rec.created[0]!.userAgentSummary === "Browser · iOS");
    check("new-login notification is sent, without a token", rec.notified.length === 1 && !dump(rec.notified).includes("MFhZ"));
  }

  /* --------------------- token + response hygiene --------------------- */
  {
    const { deps } = makeDeps({ token: "OPAQUE_RANDOM_TOKEN_VALUE_abc123" });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "s3cret-pw" }), deps);
    const view = res.body.session as Record<string, unknown>;
    check("token is forwarded verbatim from the session store (not re-minted)", res.body.token === "OPAQUE_RANDOM_TOKEN_VALUE_abc123");
    check("response body has ONLY token + session", Object.keys(res.body).sort().join(",") === "session,token");
    check("token does not encode the user id", !String(res.body.token).includes("user_1"));
    check("token does not encode the email", !String(res.body.token).includes("ada@tamanor.test"));
    check("token does not encode the tenant id", !String(res.body.token).includes("tenant_1"));
    check("token is not a JWT (no header.payload.signature)", String(res.body.token).split(".").length !== 3);
    check("session view exposes NO internal ids", !("userId" in view) && !("tenantId" in view) && !("sessionId" in view));
    check("session view exposes no password hash", !dump(view).includes("argon2"));
    check("response never echoes the password", !dump(res).includes("s3cret-pw"));
  }
  {
    const { deps } = makeDeps({ passwordOk: false });
    const res = await handleMobileLogin(loginReq({ email: "ada@tamanor.test", password: "s3cret-pw" }), deps);
    check("failure body is ONLY a bounded error code", Object.keys(res.body).join(",") === "error");
    check("failure body never echoes the password", !dump(res).includes("s3cret-pw"));
    check("failure body carries no token", !dump(res).includes("token"));
  }

  /* --------------------- workspace routing --------------------- */
  {
    const { deps } = makeDeps({ sessionOverride: { workspaceKind: "business" } });
    const res = await handleMobileLogin(loginReq({ email: "a@b.co", password: "pw" }), deps);
    check("business workspace classified as business", (res.body.session as Record<string, unknown>).workspace === "business");
  }
  {
    const { deps } = makeDeps({ sessionOverride: { workspaceKind: "family" } });
    const res = await handleMobileLogin(loginReq({ email: "a@b.co", password: "pw" }), deps);
    check("family workspace classified as family", (res.body.session as Record<string, unknown>).workspace === "family");
  }
  for (const kind of ["", "internal", "child_safety_organization", "BUSINESS", "garbage", null, undefined]) {
    const { deps } = makeDeps({ sessionOverride: { workspaceKind: kind as string } });
    const res = await handleMobileLogin(loginReq({ email: "a@b.co", password: "pw" }), deps);
    check(`unknown workspace kind ${dump(kind)} FAILS CLOSED to unsupported`, (res.body.session as Record<string, unknown>).workspace === "unsupported");
  }

  /* ===================== SESSION ===================== */
  console.log("\nSESSION");

  {
    const { deps } = makeDeps();
    const res = await handleMobileSession({ authorization: "Bearer good-token" }, deps);
    const view = (res.body.session ?? {}) as Record<string, unknown>;
    check("valid token resolves the session", res.status === 200 && view.userEmail === "ada@tamanor.test");
    check("session response exposes no internal ids", !("userId" in view) && !("tenantId" in view) && !("sessionId" in view));
  }

  for (const [label, header] of [
    ["missing header", null], ["empty header", ""], ["bare token", "abcdef"],
    ["wrong scheme", "Basic abcdef"], ["Bearer with no token", "Bearer "],
    ["Bearer only", "Bearer"], ["token with space", "Bearer ab cd"],
  ] as const) {
    const { deps } = makeDeps();
    const res = await handleMobileSession({ authorization: header }, deps);
    check(`malformed/missing bearer → 401 (${label})`, res.status === 401 && res.body.error === "unauthenticated");
  }

  const rejectCases: Array<[SessionRejectReason, string]> = [
    ["session_revoked", "session_revoked"],
    ["password_changed", "session_revoked"],
    ["session_expired", "session_expired"],
    ["session_expired_idle", "session_expired"],
    ["session_expired_absolute", "session_expired"],
    ["membership_missing", "unauthenticated"],
    ["user_missing", "unauthenticated"],
    ["tenant_missing", "unauthenticated"],
    ["tenant_deleting", "unauthenticated"],
    ["unauthenticated", "unauthenticated"],
  ];
  for (const [reason, expected] of rejectCases) {
    const { deps } = makeDeps({ readResult: { ok: false, reason } });
    const res = await handleMobileSession({ authorization: "Bearer t" }, deps);
    check(`${reason} → 401 ${expected} (fail closed)`, res.status === 401 && res.body.error === expected);
    check(`${reason} response carries no session data`, !("session" in res.body));
  }
  {
    const { deps, rec } = makeDeps({ readResult: { ok: false, reason: "session_expired_idle" } });
    await handleMobileSession({ authorization: "Bearer t" }, deps);
    check("idle expiry is audited", rec.events.some((e) => e.event === "auth.session_expired_idle"));
  }
  {
    const { deps, rec } = makeDeps({ readResult: { ok: false, reason: "session_expired_absolute" } });
    await handleMobileSession({ authorization: "Bearer t" }, deps);
    check("absolute expiry is audited", rec.events.some((e) => e.event === "auth.session_expired_absolute"));
  }
  {
    // ok:true with no session must still fail closed rather than crash or pass.
    const { deps } = makeDeps({ readResult: { ok: true, session: undefined } });
    const res = await handleMobileSession({ authorization: "Bearer t" }, deps);
    check("ok-but-empty session result fails closed", res.status === 401);
  }

  /* ===================== LOGOUT ===================== */
  console.log("\nLOGOUT");

  {
    const { deps, rec } = makeDeps();
    const res = await handleMobileLogout({ authorization: "Bearer tok-1" }, deps);
    check("valid logout revokes the session SERVER-SIDE", res.status === 200 && rec.revoked[0] === "tok-1");
    check("logout is audited", rec.events.some((e) => e.event === "auth.logout"));
  }
  {
    const { deps, rec } = makeDeps();
    await handleMobileLogout({ authorization: "Bearer tok-1" }, deps);
    const again = await handleMobileLogout({ authorization: "Bearer tok-1" }, deps);
    check("repeated logout is idempotent and safe", again.status === 200 && rec.revoked.length === 2);
  }
  {
    const { deps, rec } = makeDeps();
    const res = await handleMobileLogout({ authorization: null }, deps);
    check("logout without a bearer → 401, nothing revoked", res.status === 401 && rec.revoked.length === 0);
  }
  {
    // After revocation the store rejects the token — the session endpoint must too.
    const { deps } = makeDeps({ readResult: { ok: false, reason: "session_revoked" } });
    const res = await handleMobileSession({ authorization: "Bearer revoked" }, deps);
    check("revoked token cannot access the session endpoint", res.status === 401 && res.body.error === "session_revoked");
  }

  /* ===================== TENANT / IDENTITY ISOLATION ===================== */
  console.log("\nTENANT ISOLATION");

  {
    // The service resolves EVERYTHING from the token's own session. A client that
    // asks for another tenant/user gets its own session regardless.
    const b = session({ userId: "user_B", userEmail: "bob@tamanor.test", tenantId: "tenant_B", tenantName: "Beta" });
    const { deps } = makeDeps({ readResult: { ok: true, session: b } });
    const res = await handleMobileSession({ authorization: "Bearer token-for-B" }, deps);
    const view = res.body.session as Record<string, unknown>;
    check("token for B resolves B — never A", view.userEmail === "bob@tamanor.test" && view.tenantName === "Beta");
  }
  {
    const { deps, rec } = makeDeps();
    const res = await handleMobileLogin(
      loginReq({ email: "ada@tamanor.test", password: "pw", tenantId: "tenant_EVIL", userId: "user_EVIL", role: "owner", activeTenantId: "tenant_EVIL" }),
      deps,
    );
    const view = res.body.session as Record<string, unknown>;
    check("client-supplied tenantId cannot influence session creation", dump(rec.created[0]) === dump({ userId: "user_1", rememberMe: false, userAgentSummary: "Browser · iOS" }));
    check("client-supplied identity fields are ignored in the response", view.tenantName === "Acme" && view.role === "owner");
    check("client cannot inject a session token into login", !dump(rec.created).includes("EVIL"));
  }
  {
    const { deps } = makeDeps({ sessionOverride: { role: "member" } });
    const res = await handleMobileLogin(loginReq({ email: "a@b.co", password: "pw", role: "owner" }), deps);
    check("role comes from the server session, not the request", (res.body.session as Record<string, unknown>).role === "member");
  }

  /* ===================== PURE HELPERS ===================== */
  console.log("\nHELPERS");

  check("bearerToken parses the canonical form", bearerToken("Bearer abc123") === "abc123");
  check("bearerToken tolerates surrounding whitespace", bearerToken("  Bearer abc123  ") === "abc123");
  check("bearerToken is case-sensitive on the scheme", bearerToken("bearer abc") === null);
  check("bearerToken rejects an empty value", bearerToken("Bearer ") === null);
  check("bearerToken rejects a null header", bearerToken(null) === null && bearerToken(undefined) === null);
  check("mapRejectReason is total (unknown → unauthenticated)", mapRejectReason(undefined) === "unauthenticated");
  check("mapRejectReason never returns a raw internal reason",
    rejectCases.every(([r, e]) => mapRejectReason(r) === e));

  /* ===================== SHARED-CORE ANTI-DRIFT ===================== */
  // The whole point of `login-core` is that web and mobile cannot drift onto two
  // different credential sequences. These read the real sources and fail if either
  // transport grows its own copy of the security-sensitive steps.
  console.log("\nSHARED CORE");

  const webAction = readSrc("apps/web/src/app/login/actions.ts");
  const mobileSvc = readSrc("apps/web/src/server/mobile-auth.ts");
  const mobileDeps = readSrc("apps/web/src/server/mobile-auth-deps.ts");

  check("web login action delegates to the shared credential core", webAction.includes("authenticateCredentials("));
  check("mobile login delegates to the shared credential core", mobileSvc.includes("deps.authenticateCredentials("));
  check("web action no longer hand-rolls the dummy verify", !webAction.includes("DUMMY_PASSWORD_HASH"));
  check("web action no longer hand-rolls the challenge branch", !webAction.includes("getTurnstileConfig()"));
  check("web action no longer calls the limiters directly", !webAction.includes("authLimiter.check"));
  check("mobile service never calls a limiter directly", !mobileSvc.includes("authLimiter") && !mobileSvc.includes("loginChallengeLimiter"));
  check("mobile service never imports a password verifier", !mobileSvc.includes("verifyPassword"));
  check("both transports build deps from the ONE wiring", webAction.includes("realCredentialDeps") && mobileDeps.includes("realCredentialDeps"));
  check("mobile reuses the SAME session store as web", ["createUserSession", "readUserSession", "revokeUserSession"].every((f) => mobileDeps.includes(f)));
  check("mobile does not introduce a second session table/model", !mobileDeps.includes("prisma") && !mobileSvc.includes("prisma"));
  check("mobile never mints its own token", !mobileSvc.includes("randomBytes") && !mobileSvc.includes("jwt") && !mobileSvc.includes("sign("));
  check("mobile routes set no cookie", ["login", "session", "logout"].every((r) => !readSrc(`apps/web/src/app/api/mobile/auth/${r}/route.ts`).includes("cookies")));
  check("mobile responses are marked no-store", ["login", "session", "logout"].every((r) => readSrc(`apps/web/src/app/api/mobile/auth/${r}/route.ts`).includes("no-store")));
  check("no mobile bypass header/secret exists", !mobileSvc.includes("x-mobile") && !mobileDeps.includes("x-mobile") && !mobileSvc.includes("MOBILE_SECRET"));

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — mobile auth API (M2): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
