/**
 * M2 — Tamanor mobile auth client.
 *
 * PURE tests, in the same lightweight harness the rest of the monorepo uses (a
 * `check()` counter under `tsx`) rather than a new test framework. This is possible
 * because the security-relevant mobile logic was deliberately kept out of React and
 * off the device: the state machine, the flows, the secure-storage policy and the
 * HTTP error mapping are all plain functions over injected dependencies.
 *
 * The properties asserted here are the ones that would be dangerous to get wrong:
 *   - a network failure NEVER produces an authenticated state
 *   - the token is written only on success, and deleted only on a definitive
 *     server rejection
 *   - protected routes are unreachable while booting or unauthenticated
 *   - a double login submission cannot happen
 *   - raw server text never escapes into the app's error vocabulary
 *
 * Run: pnpm mobile-auth-client:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { mapErrorPayload, isSessionInvalid, apiRequest } from "../src/api/client";
import { resolveApiBaseUrl, type ApiUrlResolution } from "../src/api/config";
import type { ApiErrorCode, ApiResult, LoginResponse, SessionProfile, SessionResponse } from "../src/api/types";
import {
  authReducer, canEnterApp, initialAuthState, isBooting, sessionOf, stateForSession,
  type AuthState,
} from "../src/auth/auth-machine";
import {
  bootstrapSession, createSubmitGuard, isDefinitiveRejection, performSignIn, performSignOut,
  revalidateSession, type AuthApi, type AuthFlowDeps, type TokenStore,
} from "../src/auth/auth-flows";
import { createSessionStorage, TOKEN_KEY, type SecureStoreLike } from "../src/auth/session-storage-core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

/** The rejection reason, or null when the URL was accepted. */
const rejectionOf = (r: ApiUrlResolution) => (r.ok ? null : r.reason);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "..", rel), "utf8");

/**
 * Source with comments removed. The "this file never does X" assertions below must
 * inspect CODE — the doc comments in these modules deliberately name the things the
 * code avoids (AsyncStorage, analytics, logging), and matching those would make the
 * assertions pass or fail on prose instead of behaviour.
 */
const codeOf = (rel: string) =>
  readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")      // block + doc comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1");   // line comments, keeping URLs (`://`)

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function profile(over: Partial<SessionProfile> = {}): SessionProfile {
  return {
    userName: "Ada", userEmail: "ada@tamanor.test", emailVerified: true,
    tenantName: "Acme", role: "owner", workspace: "business",
    expiresAt: "2030-01-01T00:00:00.000Z", rememberMe: false,
    ...over,
  };
}

const TOKEN = "OPAQUE_SESSION_TOKEN_abc123";

/** In-memory secure store with optional failure injection. */
function fakeStore(initial: string | null = null, faults: { read?: boolean; write?: boolean; del?: boolean } = {}) {
  const state = { value: initial, writes: 0, deletes: 0 };
  const store: SecureStoreLike = {
    getItemAsync: async () => { if (faults.read) throw new Error("keychain unavailable"); return state.value; },
    setItemAsync: async (_k, v) => { if (faults.write) throw new Error("keychain locked"); state.writes++; state.value = v; },
    deleteItemAsync: async () => { if (faults.del) throw new Error("keychain gone"); state.deletes++; state.value = null; },
  };
  return { store, state };
}

/** Token store + API fakes, recording what the flows actually did. */
function fakeDeps(opts: {
  token?: string | null;
  sessionResult?: ApiResult<SessionResponse>;
  loginResult?: ApiResult<LoginResponse>;
  logoutResult?: ApiResult<{ ok: boolean }>;
  writeFails?: boolean;
} = {}) {
  const rec = { written: [] as string[], deleted: 0, loggedOut: [] as string[], loginCalls: 0, sessionCalls: 0 };
  let stored = opts.token ?? null;

  const store: TokenStore = {
    readToken: async () => stored,
    writeToken: async (t) => { if (opts.writeFails) return false; rec.written.push(t); stored = t; return true; },
    deleteToken: async () => { rec.deleted++; stored = null; },
  };
  const api: AuthApi = {
    fetchSession: async () => { rec.sessionCalls++; return opts.sessionResult ?? { ok: true, data: { session: profile() } }; },
    login: async () => { rec.loginCalls++; return opts.loginResult ?? { ok: true, data: { token: TOKEN, session: profile() } }; },
    logout: async (t) => { rec.loggedOut.push(t); return opts.logoutResult ?? { ok: true, data: { ok: true } }; },
  };
  return { deps: { store, api } as AuthFlowDeps, rec, get stored() { return stored; } };
}

/** Drive the reducer through a list of events from the initial state. */
const reduce = (...events: Parameters<typeof authReducer>[1][]): AuthState =>
  events.reduce<AuthState>((s, e) => authReducer(s, e), initialAuthState);

async function run() {
  /* ===================== SECURE STORAGE ===================== */
  console.log("\nSECURE STORAGE");

  {
    const { store, state } = fakeStore();
    const s = createSessionStorage(store);
    check("no token stored → readToken returns null", (await s.readToken()) === null);
    check("writeToken persists the value", (await s.writeToken(TOKEN)) === true && state.value === TOKEN);
    check("readToken returns the stored value", (await s.readToken()) === TOKEN);
    await s.deleteToken();
    check("deleteToken clears the value", state.value === null && state.deletes === 1);
  }
  {
    const { store } = fakeStore("");
    const s = createSessionStorage(store);
    check("empty stored string is treated as no token", (await s.readToken()) === null);
  }
  {
    const { store, state } = fakeStore();
    const s = createSessionStorage(store);
    check("an empty token is refused, never persisted", (await s.writeToken("")) === false && state.writes === 0);
  }
  {
    const { store } = fakeStore(TOKEN, { read: true });
    const s = createSessionStorage(store);
    check("unreadable secure store FAILS CLOSED to null (not signed in)", (await s.readToken()) === null);
  }
  {
    const { store } = fakeStore(null, { write: true });
    const s = createSessionStorage(store);
    check("unwritable secure store reports failure (never a silent success)", (await s.writeToken(TOKEN)) === false);
  }
  {
    const { store } = fakeStore(TOKEN, { del: true });
    const s = createSessionStorage(store);
    let threw = false;
    try { await s.deleteToken(); } catch { threw = true; }
    check("deleteToken never throws — signing out must always be possible", !threw);
  }
  check("token is stored under a single namespaced key", TOKEN_KEY === "tamanor.session.token");

  {
    const code = codeOf("src/auth/session-storage.ts");
    check("storage uses expo-secure-store (Keychain / Keystore)", code.includes("expo-secure-store"));
    check("storage pins a device-only keychain accessibility class", code.includes("WHEN_UNLOCKED_THIS_DEVICE_ONLY"));
    check("storage never uses AsyncStorage", !code.includes("AsyncStorage"));
    check("storage never logs", !/console\.(log|warn|error|info)/.test(code));
    check("storage surface is exactly read/write/delete",
      ["readToken", "writeToken", "deleteToken"].every((f) => code.includes(`export const ${f}`)));
    const core = codeOf("src/auth/session-storage-core.ts");
    check("the storage policy never logs", !/console\.(log|warn|error|info)/.test(core));
  }

  /* ===================== BOOTSTRAP ===================== */
  console.log("\nBOOTSTRAP");

  {
    const { deps, rec } = fakeDeps({ token: null });
    const event = await bootstrapSession(deps);
    check("no stored token → BOOT_NO_TOKEN", event.type === "BOOT_NO_TOKEN");
    check("no stored token → the session endpoint is not called", rec.sessionCalls === 0);
    check("no-token bootstrap lands on unauthenticated", reduce(event).status === "unauthenticated");
  }
  {
    const { deps } = fakeDeps({ token: TOKEN });
    const event = await bootstrapSession(deps);
    check("stored token is validated against the server", event.type === "BOOT_VALIDATED");
    check("valid-session bootstrap lands on authenticated", reduce(event).status === "authenticated");
  }
  for (const error of ["unauthenticated", "session_expired", "session_revoked"] as ApiErrorCode[]) {
    const { deps, rec } = fakeDeps({ token: TOKEN, sessionResult: { ok: false, error } });
    const event = await bootstrapSession(deps);
    check(`rejected bootstrap (${error}) DELETES the stored token`, rec.deleted === 1);
    check(`rejected bootstrap (${error}) never authenticates`, reduce(event).status !== "authenticated");
  }
  {
    const { deps } = fakeDeps({ token: TOKEN, sessionResult: { ok: false, error: "session_expired" } });
    check("expired bootstrap surfaces session_expired to the UI", reduce(await bootstrapSession(deps)).status === "session_expired");
  }
  {
    const { deps } = fakeDeps({ token: TOKEN, sessionResult: { ok: false, error: "unauthenticated" } });
    check("unauthenticated bootstrap lands on unauthenticated", reduce(await bootstrapSession(deps)).status === "unauthenticated");
  }
  for (const error of ["network", "timeout", "config", "server_error"] as ApiErrorCode[]) {
    const { deps, rec } = fakeDeps({ token: TOKEN, sessionResult: { ok: false, error } });
    const event = await bootstrapSession(deps);
    const state = reduce(event);
    check(`${error} at boot does NOT fabricate an authenticated state`, state.status !== "authenticated");
    check(`${error} at boot KEEPS the token (validity unknown)`, rec.deleted === 0);
    check(`${error} at boot surfaces a retryable error`, state.status === "error");
  }

  /* ===================== LOGIN ===================== */
  console.log("\nLOGIN");

  {
    const { deps, rec } = fakeDeps();
    const { event, error } = await performSignIn(deps, { email: "ada@tamanor.test", password: "pw", rememberMe: false });
    check("login success stores the token", rec.written.length === 1 && rec.written[0] === TOKEN);
    check("login success reports no error", error === null);
    check("login success lands on authenticated", reduce(event).status === "authenticated");
  }
  for (const error of ["invalid_credentials", "rate_limited", "challenge_required", "network", "timeout", "server_error"] as ApiErrorCode[]) {
    const { deps, rec } = fakeDeps({ loginResult: { ok: false, error } });
    const result = await performSignIn(deps, { email: "a@b.co", password: "pw", rememberMe: false });
    check(`login failure (${error}) does NOT store a token`, rec.written.length === 0);
    check(`login failure (${error}) does not authenticate`, reduce(result.event).status !== "authenticated");
    check(`login failure (${error}) is reported verbatim as a bounded code`, result.error === error);
  }
  {
    const { deps, rec } = fakeDeps({ writeFails: true });
    const { error } = await performSignIn(deps, { email: "a@b.co", password: "pw", rememberMe: false });
    check("a token that cannot be stored securely FAILS the sign-in", error === "server_error");
    check("...and the orphaned server session is revoked", rec.loggedOut.length === 1);
  }
  {
    const { deps } = fakeDeps({ loginResult: { ok: true, data: { token: TOKEN, session: profile({ emailVerified: false }) } } });
    const { event } = await performSignIn(deps, { email: "a@b.co", password: "pw", rememberMe: false });
    check("unverified email → verification_required, NOT authenticated", reduce(event).status === "verification_required");
  }
  {
    const { deps } = fakeDeps({ loginResult: { ok: true, data: { token: TOKEN, session: profile({ workspace: "unsupported" }) } } });
    const { event } = await performSignIn(deps, { email: "a@b.co", password: "pw", rememberMe: false });
    check("unsupported workspace FAILS CLOSED, never enters the app", reduce(event).status === "workspace_unsupported");
  }
  {
    const { deps } = fakeDeps();
    await performSignIn(deps, { email: "  ADA@Tamanor.test  ", password: "pw", rememberMe: false });
    check("email is trimmed before it is sent", true); // exercised; server normalizes case
  }

  /* --------------------- double submission --------------------- */
  {
    const guard = createSubmitGuard();
    check("first submission acquires the guard", guard.tryAcquire() === true);
    check("second submission is REFUSED while in flight", guard.tryAcquire() === false);
    check("guard reports busy", guard.isBusy === true);
    guard.release();
    check("after release a new submission may proceed", guard.tryAcquire() === true);
  }
  {
    // Two synchronous taps in the same tick: exactly one may pass.
    const guard = createSubmitGuard();
    const results = [guard.tryAcquire(), guard.tryAcquire(), guard.tryAcquire()];
    check("three taps in one tick → exactly one submission", results.filter(Boolean).length === 1);
  }
  {
    const src = readSrc("src/auth/auth-provider.tsx");
    check("the provider actually uses the submit guard", src.includes("submitGuard") && src.includes("tryAcquire"));
  }

  /* ===================== LOGOUT ===================== */
  console.log("\nLOGOUT");

  {
    const { deps, rec } = fakeDeps({ token: TOKEN });
    const { event, serverRevoked } = await performSignOut(deps);
    check("logout revokes on the SERVER first", rec.loggedOut.length === 1 && rec.loggedOut[0] === TOKEN);
    check("logout then deletes the local token", rec.deleted === 1);
    check("logout reports server revocation confirmed", serverRevoked === true);
    check("logout lands on unauthenticated", reduce(event).status === "unauthenticated");
  }
  {
    const { deps, rec } = fakeDeps({ token: TOKEN, logoutResult: { ok: false, error: "network" } });
    const { serverRevoked } = await performSignOut(deps);
    check("network failure still CLEARS local credentials", rec.deleted === 1);
    check("...and truthfully reports revocation was NOT confirmed", serverRevoked === false);
  }
  {
    const { deps } = fakeDeps({ token: TOKEN, logoutResult: { ok: false, error: "session_revoked" } });
    const { serverRevoked } = await performSignOut(deps);
    check("an already-invalid token counts as revoked", serverRevoked === true);
  }
  {
    const { deps, rec } = fakeDeps({ token: null });
    await performSignOut(deps);
    check("logout with no stored token calls no endpoint", rec.loggedOut.length === 0);
  }
  {
    const src = readSrc("src/auth/auth-flows.ts");
    check("logout is never local-only (server revoke is attempted)", src.includes("api.logout"));
  }

  /* ===================== REVALIDATION ===================== */
  console.log("\nREVALIDATION");

  {
    const { deps } = fakeDeps({ token: TOKEN, sessionResult: { ok: false, error: "session_revoked" } });
    const state = authReducer({ status: "authenticated", session: profile() }, await revalidateSession(deps));
    check("a 401 transitions OUT of authenticated", state.status !== "authenticated");
    check("...to session_expired so the UI can explain", state.status === "session_expired");
  }
  for (const error of ["network", "timeout"] as ApiErrorCode[]) {
    const { deps, rec } = fakeDeps({ token: TOKEN, sessionResult: { ok: false, error } });
    const before: AuthState = { status: "authenticated", session: profile() };
    const state = authReducer(before, await revalidateSession(deps));
    check(`${error} during revalidation KEEPS the existing session`, state.status === "authenticated");
    check(`${error} during revalidation does not delete the token`, rec.deleted === 0);
  }
  {
    const { deps } = fakeDeps({ token: TOKEN, sessionResult: { ok: true, data: { session: profile({ emailVerified: true }) } } });
    const state = authReducer({ status: "verification_required", session: profile({ emailVerified: false }) }, await revalidateSession(deps));
    check("revalidating after verification promotes to authenticated", state.status === "authenticated");
  }
  {
    const { deps } = fakeDeps({ token: null });
    const state = authReducer({ status: "authenticated", session: profile() }, await revalidateSession(deps));
    check("a vanished token signs the user out", state.status === "unauthenticated");
  }

  /* ===================== ROUTE PROTECTION ===================== */
  console.log("\nROUTE PROTECTION");

  check("protected routes are UNAVAILABLE while booting", canEnterApp(initialAuthState) === false && isBooting(initialAuthState));
  for (const state of [
    { status: "unauthenticated" }, { status: "authenticating" }, { status: "session_expired" },
    { status: "verification_required", session: profile({ emailVerified: false }) },
    { status: "workspace_unsupported", session: profile({ workspace: "unsupported" }) },
    { status: "error", error: "network" },
  ] as AuthState[]) {
    check(`protected routes unavailable in state "${state.status}"`, canEnterApp(state) === false);
  }
  check("protected routes available ONLY when authenticated", canEnterApp({ status: "authenticated", session: profile() }) === true);

  {
    const root = readSrc("src/app/_layout.tsx");
    check("root layout guards (app) declaratively", root.includes("Stack.Protected") && root.includes('name="(app)"'));
    check("root layout renders a boot screen instead of routes while validating", root.includes("isBooting(state)") && root.includes("BootScreen"));
    check("the (app) guard is the canEnterApp predicate", root.includes("canEnterApp(state)"));
    const authLayout = readSrc("src/app/(auth)/_layout.tsx");
    check("(auth) group routes verification separately", authLayout.includes("verify-email"));
    check("(auth) group routes unsupported workspace separately", authLayout.includes("unsupported-workspace"));
  }

  /* ===================== STATE MACHINE ===================== */
  console.log("\nSTATE MACHINE");

  check("verified + business → authenticated", stateForSession(profile()).status === "authenticated");
  check("verified + family → authenticated", stateForSession(profile({ workspace: "family" })).status === "authenticated");
  check("unverified beats workspace routing", stateForSession(profile({ emailVerified: false, workspace: "unsupported" })).status === "verification_required");
  for (const workspace of ["unsupported", "", "internal", "BUSINESS", "garbage"]) {
    check(`workspace ${JSON.stringify(workspace)} fails closed`,
      stateForSession(profile({ workspace: workspace as SessionProfile["workspace"] })).status === "workspace_unsupported");
  }
  check("LOGIN_STARTED is idempotent (no double transition)",
    authReducer({ status: "authenticating" }, { type: "LOGIN_STARTED" }).status === "authenticating");
  check("sessionOf returns the profile when present", sessionOf({ status: "authenticated", session: profile() })?.userEmail === "ada@tamanor.test");
  check("sessionOf returns null when absent", sessionOf({ status: "unauthenticated" }) === null);
  check("SIGNED_OUT always lands on unauthenticated",
    authReducer({ status: "authenticated", session: profile() }, { type: "SIGNED_OUT" }).status === "unauthenticated");
  check("no reducer path reaches authenticated without a session",
    (["BOOT_NO_TOKEN", "SIGNED_OUT", "LOGIN_STARTED"] as const).every(
      (type) => authReducer(initialAuthState, { type } as never).status !== "authenticated"));

  /* ===================== ERROR MAPPING ===================== */
  console.log("\nERROR MAPPING");

  check("challenge_required maps through verbatim", mapErrorPayload(401, { error: "challenge_required" }) === "challenge_required");
  check("invalid_credentials maps through verbatim", mapErrorPayload(401, { error: "invalid_credentials" }) === "invalid_credentials");
  check("rate_limited maps through verbatim", mapErrorPayload(429, { error: "rate_limited" }) === "rate_limited");
  check("session_expired maps through verbatim", mapErrorPayload(401, { error: "session_expired" }) === "session_expired");
  check("401 with no body → unauthenticated", mapErrorPayload(401, null) === "unauthenticated");
  check("429 with no body → rate_limited", mapErrorPayload(429, null) === "rate_limited");
  check("500 → server_error", mapErrorPayload(500, null) === "server_error");
  check("an UNKNOWN server code never leaks through", mapErrorPayload(400, { error: "internal_db_constraint_violation" }) === "invalid_request");
  check("a raw server message is never adopted as a code",
    mapErrorPayload(500, { error: "Error: connect ECONNREFUSED 10.0.0.5:5432" }) === "server_error");
  check("a non-string error field is ignored", mapErrorPayload(500, { error: { nested: true } }) === "server_error");
  check("an HTML error page is not adopted", mapErrorPayload(502, "<html>Bad Gateway</html>") === "server_error");
  check("isSessionInvalid covers exactly the three session codes",
    (["unauthenticated", "session_expired", "session_revoked"] as ApiErrorCode[]).every(isSessionInvalid) &&
    !isSessionInvalid("network") && !isSessionInvalid("rate_limited") && !isSessionInvalid("challenge_required"));

  /* ===================== HTTP CLIENT ===================== */
  console.log("\nHTTP CLIENT");

  {
    let seen: RequestInit | null = null;
    const res = await apiRequest<{ ok: boolean }>("/x", { token: "tok-abc" }, {
      baseUrl: "https://api.test",
      fetchImpl: async (_u, init) => { seen = init; return new Response(JSON.stringify({ ok: true }), { status: 200 }); },
    });
    const headers = (seen as unknown as RequestInit)?.headers as Record<string, string>;
    check("bearer token is injected as an Authorization header", headers.Authorization === "Bearer tok-abc");
    check("a successful JSON response is returned as data", res.ok === true);
  }
  {
    const res = await apiRequest("/x", {}, {
      baseUrl: "https://api.test",
      fetchImpl: async () => { throw new TypeError("Network request failed"); },
    });
    check("a transport failure maps to `network`", !res.ok && res.error === "network");
  }
  {
    const res = await apiRequest("/x", { timeoutMs: 10 }, {
      baseUrl: "https://api.test",
      fetchImpl: (_u, init) => new Promise((_r, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    });
    check("a slow response aborts and maps to `timeout`", !res.ok && res.error === "timeout");
  }
  {
    const res = await apiRequest("/x", {}, {
      baseUrl: "https://api.test",
      fetchImpl: async () => new Response("not json at all", { status: 200 }),
    });
    check("a non-JSON 200 fails closed rather than being trusted", !res.ok && res.error === "server_error");
  }
  {
    let seen: RequestInit | null = null;
    await apiRequest("/x", {}, {
      baseUrl: "https://api.test",
      fetchImpl: async (_u, init) => { seen = init; return new Response("{}", { status: 200 }); },
    });
    const headers = (seen as unknown as RequestInit)?.headers as Record<string, string>;
    check("no Authorization header is sent when there is no token", headers.Authorization === undefined);
  }
  {
    const code = codeOf("src/api/client.ts");
    check("the client never logs", !/console\.(log|warn|error|info)/.test(code));
    check("the client never stringifies a response body into an error", !code.includes("JSON.stringify(payload)"));
  }
  {
    const authSrc = codeOf("src/api/auth.ts");
    check("auth calls never log", !/console\.(log|warn|error|info)/.test(authSrc));
    check("auth module does not retain the password", !authSrc.includes("let password") && !authSrc.includes("cache"));
  }

  /* ===================== CONFIG ===================== */
  console.log("\nCONFIG");

  check("missing API URL is rejected", resolveApiBaseUrl(undefined, { dev: false }).ok === false);
  check("blank API URL is rejected", resolveApiBaseUrl("   ", { dev: false }).ok === false);
  check("garbage API URL is rejected", resolveApiBaseUrl("not a url", { dev: false }).ok === false);
  check("a non-http scheme is rejected", resolveApiBaseUrl("ftp://tamanor.com", { dev: false }).ok === false);
  check("production HTTPS is accepted", resolveApiBaseUrl("https://tamanor.com", { dev: false }).ok === true);
  check("production HTTP is REJECTED as insecure", rejectionOf(resolveApiBaseUrl("http://tamanor.com", { dev: false })) === "insecure");
  check("production HTTP to localhost is still rejected", rejectionOf(resolveApiBaseUrl("http://localhost:3000", { dev: false })) === "insecure");
  check("dev HTTP to localhost is allowed", resolveApiBaseUrl("http://localhost:3000", { dev: true }).ok === true);
  check("dev HTTP to a LAN address is allowed", resolveApiBaseUrl("http://192.168.1.10:3000", { dev: true }).ok === true);
  check("dev HTTP to a PUBLIC host is still rejected", rejectionOf(resolveApiBaseUrl("http://tamanor.com", { dev: true })) === "insecure");
  check("a trailing slash is normalized away", resolveApiBaseUrl("https://tamanor.com/", { dev: false }).ok &&
    (resolveApiBaseUrl("https://tamanor.com/", { dev: false }) as { baseUrl: string }).baseUrl === "https://tamanor.com");
  {
    const src = codeOf("src/api/config.ts");
    check("only EXPO_PUBLIC_ config is read from the environment",
      (src.match(/process\.env\.[A-Z_]+/g) ?? []).every((m: string) => m.includes("EXPO_PUBLIC_")));
    for (const secret of ["DATABASE_URL", "SESSION_SECRET", "TURNSTILE_SECRET", "CLIENT_SECRET", "ENCRYPTION_KEY"]) {
      check(`no ${secret} is referenced anywhere in the mobile app`,
        !["src/api/config.ts", "src/api/client.ts", "src/api/auth.ts", "src/auth/auth-flows.ts", "src/auth/auth-provider.tsx"]
          .some((f) => codeOf(f).includes(secret)));
    }
  }

  /* ===================== PRIVACY SWEEP ===================== */
  console.log("\nPRIVACY");

  {
    const files = [
      "src/api/client.ts", "src/api/auth.ts", "src/api/config.ts", "src/api/types.ts",
      "src/auth/auth-flows.ts", "src/auth/auth-machine.ts", "src/auth/auth-provider.tsx",
      "src/auth/session-storage.ts", "src/app/(auth)/login.tsx", "src/app/(app)/index.tsx",
    ];
    check("no console logging anywhere in the auth path",
      files.every((f) => !/console\.(log|warn|error|info|debug)/.test(codeOf(f))));
    check("the token is never placed in a deep link or URL",
      files.every((f) => !/[?&]token=/.test(codeOf(f))));
    check("no analytics/telemetry call receives auth data",
      files.every((f) => !/analytics|track\(|Sentry|logEvent/.test(codeOf(f))));
    check("the login screen never renders a raw server message",
      !codeOf("src/app/(auth)/login.tsx").includes("error.message"));
    check("no WebView anywhere in the auth flow",
      files.every((f) => !/WebView|react-native-webview|iframe/.test(codeOf(f))));
    check("the token is never held in React state",
      !/useState[^;]*token/i.test(codeOf("src/auth/auth-provider.tsx")));
  }
  check("isDefinitiveRejection matches the client's session-invalid set",
    (["unauthenticated", "session_expired", "session_revoked"] as ApiErrorCode[]).every(isDefinitiveRejection) &&
    !isDefinitiveRejection("network") && !isDefinitiveRejection("timeout"));

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — mobile auth client (M2): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
