/**
 * M2 — TRANSPORT-AGNOSTIC credential authentication.
 *
 * This is the single implementation of the security-sensitive part of signing in:
 * rate limiting, bounded input validation, the adaptive bot challenge, and the
 * enumeration-safe credential check. It was extracted from the web login Server
 * Action (`apps/web/src/app/login/actions.ts`) so the native mobile login route
 * runs the SAME sequence rather than a second copy of it.
 *
 * What is deliberately NOT here:
 *   - CSRF / same-origin — browser-transport specific (a bearer token is not
 *     attached automatically by a user agent, so the web action keeps that check).
 *   - session issuance — the caller decides the transport (cookie jar vs. bearer).
 *   - redirects — the caller decides how to surface an outcome.
 *
 * Every dependency is injected, and this module imports no runtime value (types
 * only), so it can be unit-tested with fakes: no database, no Next, no network.
 * Result codes are a bounded union; nothing here ever returns or logs a password,
 * a hash, a session token, or a challenge token.
 */

import type { OpsEvent } from "@guardora/core";

/** The shape a login attempt is allowed to take. Nothing else is read. */
export interface CredentialLoginInput {
  email: string;
  password: string;
  /** Minimized per-IP key (already hashed/derived by `ipKeyFromHeader`). */
  ipKey: string;
  /** Turnstile response token, when the client supplied one. */
  challengeToken?: string | null;
  /** Client IP passed through to the challenge provider, when known. */
  remoteIp?: string | null;
}

/**
 * Bounded failure vocabulary. These are the ONLY values that reach a client, and
 * `invalid_credentials` is deliberately shared by "no such account" and "wrong
 * password" so neither response nor timing distinguishes them.
 */
export type CredentialFailure = "rate_limited" | "invalid_credentials" | "challenge_required";

export type CredentialOutcome =
  | { ok: true; userId: string }
  | { ok: false; failure: CredentialFailure };

/** Just the limiter surface this module needs. */
export interface LimiterLike {
  check(key: string): Promise<{ allowed: boolean }>;
}

export interface CredentialDeps {
  /** Hard, fail-closed brute-force gate. Checked per-IP AND per-email. */
  authLimiter: LimiterLike;
  /** Adaptive-challenge trigger. `allowed:false` means a challenge is REQUIRED. */
  challengeLimiter: LimiterLike;
  /** Whether a challenge provider is configured at all. */
  turnstileEnabled: () => boolean;
  /** Server-side challenge verification. Fail-closed inside. */
  verifyChallenge: (
    token: string | null | undefined,
    required: boolean,
    remoteIp?: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  normalizeEmail: (email: string) => string;
  findUserForLogin: (email: string) => Promise<{ id: string; passwordHash: string | null } | null>;
  verifyPassword: (hash: string | null | undefined, plaintext: string) => Promise<boolean>;
  /** Pre-computed Argon2id hash used to equalize timing for a missing account. */
  dummyPasswordHash: string;
  metrics: { inc: (name: string, labels?: Record<string, string>) => void };
  emitOpsEvent: (event: OpsEvent, meta?: Record<string, unknown>) => void;
}

/**
 * The email shape accepted at the login boundary. Exported so the web action and
 * the mobile route cannot drift onto two different definitions of "looks like an
 * email". Deliberately permissive — real validation is "does it match a row".
 */
export const LOGIN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Longest accepted field lengths — bounds the work an unauthenticated caller can cause. */
export const MAX_EMAIL_LENGTH = 320;
export const MAX_PASSWORD_LENGTH = 1024;

/**
 * Verify credentials. Returns the user id on success; never a user object, never a
 * hash. The caller then issues a session in whatever transport it owns.
 *
 * Order is significant and mirrors the web action exactly:
 *   1. per-IP hard rate limit (fail closed)
 *   2. bounded input validation
 *   3. per-email hard rate limit (fail closed)
 *   4. adaptive bot challenge (server decides; the client cannot opt out)
 *   5. account lookup
 *   6. ALWAYS a full Argon2 verify — against a dummy hash when the account is
 *      missing or has no local password — so timing never reveals registration
 */
export async function authenticateCredentials(
  input: CredentialLoginInput,
  deps: CredentialDeps,
): Promise<CredentialOutcome> {
  const rateLimited = (): CredentialOutcome => {
    deps.metrics.inc("auth_rate_limited_total", { operation: "login" });
    return { ok: false, failure: "rate_limited" };
  };
  const invalid = (): CredentialOutcome => ({ ok: false, failure: "invalid_credentials" });

  // 1) Per-IP brute-force gate.
  if (!(await deps.authLimiter.check(`ip:${input.ipKey}`)).allowed) return rateLimited();

  const email = input.email.trim();
  const password = input.password;

  // 2) Bounded validation. Over-long inputs are rejected before any Argon2 work so
  //    an unauthenticated caller cannot force unbounded hashing cost.
  if (
    email.length > MAX_EMAIL_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    !LOGIN_EMAIL_RE.test(email) ||
    !password
  ) {
    return invalid();
  }

  const normalized = deps.normalizeEmail(email);

  // 3) Per-account brute-force gate.
  if (!(await deps.authLimiter.check(`email:${normalized}`)).allowed) return rateLimited();

  // 4) ADAPTIVE bot challenge — the SERVER decides. Once recent attempts for this
  //    (account|ip) reach the threshold a valid challenge is required. There is no
  //    client-supplied flag, header or platform hint that can skip this.
  const challengeRequired = !(await deps.challengeLimiter.check(`${normalized}|${input.ipKey}`)).allowed;
  if (deps.turnstileEnabled() && challengeRequired) {
    const challenge = await deps.verifyChallenge(
      input.challengeToken ?? "",
      true,
      input.remoteIp ?? undefined,
    );
    if (!challenge.ok) {
      deps.emitOpsEvent("auth.turnstile_failed", { operation: "login", reason: challenge.reason ?? "invalid" });
      deps.emitOpsEvent("auth.login_blocked", { operation: "login", reason: "bot_challenge" });
      return { ok: false, failure: "challenge_required" };
    }
  } else if (challengeRequired) {
    // No provider configured — record that a challenge WOULD be required. This is
    // an audit signal, never a claim that the attempt was verified.
    deps.emitOpsEvent("auth.bot_challenge", { operation: "login", reason: "challenge_required_no_provider" });
  }

  // 5) Lookup.
  const user = await deps.findUserForLogin(email);

  // 6) Enumeration-safe verification.
  if (!user || !user.passwordHash) {
    await deps.verifyPassword(deps.dummyPasswordHash, password);
    deps.metrics.inc("auth_login_total", { operation: "login", result: "denied" });
    deps.emitOpsEvent("auth.login_failed", { operation: "login", reason: "invalid_credentials" });
    return invalid();
  }

  if (!(await deps.verifyPassword(user.passwordHash, password))) {
    deps.metrics.inc("auth_login_total", { operation: "login", result: "denied" });
    deps.emitOpsEvent("auth.login_failed", { operation: "login", reason: "invalid_credentials" });
    return invalid();
  }

  return { ok: true, userId: user.id };
}
