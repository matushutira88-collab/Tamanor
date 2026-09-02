/**
 * M2 — native mobile authentication service.
 *
 * The native app cannot use the browser cookie transport, so it carries the SAME
 * opaque `UserSession` token in an `Authorization: Bearer` header. Nothing about
 * the session model changes: the token is the identical high-entropy random value
 * minted by `createUserSession`, only its SHA-256 hash is stored, and identity /
 * tenant / role are resolved server-side from a validated `UserSession` row on
 * every request. The token is NOT a JWT and encodes nothing.
 *
 * Credential checking is not reimplemented here — it delegates to the shared
 * `authenticateCredentials` core that the web Server Action also uses, so rate
 * limits, the adaptive bot challenge and enumeration-safety are identical.
 *
 * Everything is injected, and this module imports no runtime value (types only),
 * so the whole request lifecycle is unit-testable without a database or network.
 *
 * PRIVACY: no function here returns or logs a password, a password hash, a session
 * token (outside the single login response body that must carry it), a raw DB row,
 * or an internal identifier. Client-visible errors are a bounded code vocabulary.
 */

import type { OpsEvent } from "@guardora/core";
import type { ResolvedSession, SessionRejectReason } from "@guardora/db";
import type { CredentialDeps, CredentialLoginInput, CredentialOutcome } from "./login-core";

/* -------------------------------------------------------------------------- */
/* Wire contract                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where the server says this account belongs. Mirrors `classifyWorkspaceRouting`
 * and is FAIL-CLOSED: an unknown or corrupt workspace kind is `unsupported`, never
 * a Business default. The mobile client must treat `unsupported` as "cannot enter
 * the app", not as something to guess about.
 */
export type MobileWorkspace = "business" | "family" | "unsupported";

/**
 * The ONLY account fields the native client receives. Deliberately display-and-
 * routing data: no user id, tenant id, session id, password hash, membership list,
 * or DB row internals. The client never needs them — the server re-resolves
 * identity from the bearer token on every request.
 */
export interface MobileSessionView {
  userName: string;
  userEmail: string;
  emailVerified: boolean;
  tenantName: string;
  role: string;
  workspace: MobileWorkspace;
  /** ISO-8601. Lets the client show a truthful expiry, never enforce one. */
  expiresAt: string;
  rememberMe: boolean;
}

/** Bounded, client-safe error vocabulary. Never a raw server or provider string. */
export type MobileAuthError =
  | "invalid_request"
  | "invalid_credentials"
  | "rate_limited"
  | "challenge_required"
  | "unauthenticated"
  | "session_expired"
  | "session_revoked"
  | "server_error";

export interface MobileAuthResponse {
  status: number;
  body: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

export interface MobileAuthDeps {
  /** The shared credential core (rate limits + challenge + enumeration-safety). */
  authenticateCredentials: (
    input: CredentialLoginInput,
    deps: CredentialDeps,
  ) => Promise<CredentialOutcome>;
  credentialDeps: CredentialDeps;

  /** Mints a fresh server-side session. Same function the web cookie path uses. */
  createUserSession: (input: {
    userId: string;
    rememberMe?: boolean;
    userAgentSummary?: string;
  }) => Promise<{ token: string; session: ResolvedSession }>;
  /** Validates a raw token; enforces revocation, idle, absolute, membership, etc. */
  readUserSession: (
    token: string | null | undefined,
  ) => Promise<{ ok: boolean; session?: ResolvedSession; reason?: SessionRejectReason }>;
  /** Idempotent server-side revocation. */
  revokeUserSession: (token: string | null | undefined) => Promise<void>;

  classifyWorkspace: (workspaceKind: unknown) => MobileWorkspace;
  /** Coarse, privacy-preserving device label derived server-side from the UA. */
  summarizeUserAgent: (ua: string | null | undefined) => string | null;
  /** Best-effort "new sign-in" notification. Failure must never block login. */
  notifyNewLogin?: (email: string, device: string | null) => Promise<void>;

  metrics: { inc: (name: string, labels?: Record<string, string>) => void };
  emitOpsEvent: (event: OpsEvent, meta?: Record<string, unknown>) => void;
  now?: () => Date;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const err = (status: number, error: MobileAuthError): MobileAuthResponse => ({ status, body: { error } });

/**
 * Extract the opaque token from an `Authorization` header. Accepts only the exact
 * `Bearer <token>` form. Anything else — a missing header, another scheme, an
 * empty value, or embedded whitespace — yields null so the caller fails closed.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Map an internal session rejection to the bounded client vocabulary. Every
 * non-success reason collapses to one of three codes — the client learns that it
 * must sign in again, never *why* in a way that aids an attacker.
 */
export function mapRejectReason(reason: SessionRejectReason | undefined): MobileAuthError {
  switch (reason) {
    case "session_expired":
    case "session_expired_idle":
    case "session_expired_absolute":
      return "session_expired";
    case "session_revoked":
    case "password_changed":
      return "session_revoked";
    default:
      // membership_missing / user_missing / tenant_missing / tenant_deleting /
      // unauthenticated all fail closed as "not signed in".
      return "unauthenticated";
  }
}

/** Project a validated server session into the client-safe view. */
export function toSessionView(session: ResolvedSession, workspace: MobileWorkspace): MobileSessionView {
  return {
    userName: session.userName,
    userEmail: session.userEmail,
    emailVerified: session.emailVerified,
    tenantName: session.tenantName,
    role: session.role,
    workspace,
    expiresAt: session.expiresAt.toISOString(),
    rememberMe: session.rememberMe,
  };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/auth/login                                                 */
/* -------------------------------------------------------------------------- */

export interface MobileLoginRequest {
  /** Already-parsed JSON body. Unknown shape — validated here. */
  body: unknown;
  /** Minimized per-IP key from `ipKeyFromHeader`. */
  ipKey: string;
  remoteIp?: string | null;
  userAgent?: string | null;
}

/**
 * Native login. Runs the shared credential sequence, then mints a fresh session
 * and returns its opaque token.
 *
 * A successful response is the ONLY place a token crosses the wire. An unverified
 * email still receives a session (matching web, where the cookie is set and the
 * user is redirected to /verify-email) — `emailVerified: false` in the view is the
 * gate, and the client must not enter the app on it.
 */
export async function handleMobileLogin(
  req: MobileLoginRequest,
  deps: MobileAuthDeps,
): Promise<MobileAuthResponse> {
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err(400, "invalid_request");
  }
  const raw = body as Record<string, unknown>;

  // Only these fields are read. Anything else in the payload is ignored — there is
  // no client-supplied session token, tenant id, role, or challenge-bypass flag.
  const email = typeof raw.email === "string" ? raw.email : "";
  const password = typeof raw.password === "string" ? raw.password : "";
  const rememberMe = raw.rememberMe === true;
  const challengeToken = typeof raw.challengeToken === "string" ? raw.challengeToken : null;

  if (!email || !password) return err(400, "invalid_request");

  const outcome = await deps.authenticateCredentials(
    { email, password, ipKey: req.ipKey, challengeToken, remoteIp: req.remoteIp ?? null },
    deps.credentialDeps,
  );

  if (!outcome.ok) {
    // 429 for a rate limit, 401 for everything else — the two credential failures
    // ("no such account" / "wrong password") are already collapsed by the core.
    const status = outcome.failure === "rate_limited" ? 429 : 401;
    return err(status, outcome.failure);
  }

  const device = deps.summarizeUserAgent(req.userAgent);

  let issued: { token: string; session: ResolvedSession };
  try {
    issued = await deps.createUserSession({
      userId: outcome.userId,
      rememberMe,
      userAgentSummary: device ?? undefined,
    });
  } catch {
    // createUserSession throws when the user has no valid tenant membership. Fail
    // closed with a generic code — never surface the internal reason to a client.
    deps.metrics.inc("auth_login_total", { operation: "login_mobile", result: "denied" });
    deps.emitOpsEvent("auth.login_failed", { operation: "login_mobile", reason: "no_membership" });
    return err(401, "invalid_credentials");
  }

  deps.metrics.inc("auth_login_total", { operation: "login_mobile", result: "ok" });
  deps.emitOpsEvent("auth.login_succeeded", {
    operation: "login_mobile",
    result: rememberMe ? "remember" : "session",
  });

  // Best-effort security notification, exactly as the web path does. Never blocks
  // login and never carries the token.
  try {
    await deps.notifyNewLogin?.(issued.session.userEmail, device);
  } catch {
    /* delivery failure must not block login (already audited inside) */
  }

  return {
    status: 200,
    body: {
      token: issued.token,
      session: toSessionView(issued.session, deps.classifyWorkspace(issued.session.workspaceKind)),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/auth/session                                                */
/* -------------------------------------------------------------------------- */

/**
 * The authoritative "is this session still good" endpoint the app calls on cold
 * start and after a meaningful background interval. Full validation runs on every
 * call — revocation, token expiry, absolute ceiling, idle timeout, membership and
 * passwordChangedAt — because it delegates to the same `readUserSession` the web
 * render path uses.
 */
export async function handleMobileSession(
  req: { authorization: string | null | undefined },
  deps: MobileAuthDeps,
): Promise<MobileAuthResponse> {
  const token = bearerToken(req.authorization);
  if (!token) return err(401, "unauthenticated");

  const result = await deps.readUserSession(token);
  if (!result.ok || !result.session) {
    const mapped = mapRejectReason(result.reason);
    // Mirror the web read path: audit only the security-relevant lifetime rejections.
    if (result.reason === "session_expired_idle") {
      deps.emitOpsEvent("auth.session_expired_idle", { reason: result.reason });
    } else if (result.reason === "session_expired_absolute") {
      deps.emitOpsEvent("auth.session_expired_absolute", { reason: result.reason });
    }
    return err(401, mapped);
  }

  return {
    status: 200,
    body: {
      session: toSessionView(result.session, deps.classifyWorkspace(result.session.workspaceKind)),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/auth/logout                                                */
/* -------------------------------------------------------------------------- */

/**
 * Server-side revocation. `revokeUserSession` is idempotent, so repeating a logout
 * — or logging out with an already-revoked token — is safe and still reports 200:
 * the client's goal ("this token must stop working") is satisfied either way, and
 * a distinct response would leak whether a token was ever valid.
 *
 * A request with no usable bearer is 401: there is nothing to revoke, and the
 * client should already be clearing local state.
 */
export async function handleMobileLogout(
  req: { authorization: string | null | undefined },
  deps: MobileAuthDeps,
): Promise<MobileAuthResponse> {
  const token = bearerToken(req.authorization);
  if (!token) return err(401, "unauthenticated");

  await deps.revokeUserSession(token);
  deps.emitOpsEvent("auth.logout", { operation: "logout_mobile" });
  return { status: 200, body: { ok: true } };
}
