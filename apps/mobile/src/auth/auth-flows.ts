/**
 * The auth ORCHESTRATION, extracted from React.
 *
 * Each flow is an async function over injected dependencies that returns the
 * {@link AuthEvent} to dispatch. Keeping them here (rather than inline in the
 * provider) means the rules that actually matter — when a token is written, when
 * it is deleted, and what a failure is allowed to imply — are testable without a
 * React renderer, a device, or a network.
 *
 * The safety property these encode: a token is DELETED only on a definitive server
 * rejection, and an `authenticated` outcome is produced only from a successful
 * server validation. Connectivity failures leave both the token and the state alone.
 */

import type { ApiErrorCode, ApiResult, LoginResponse, SessionResponse } from "@/api/types";
import type { AuthEvent } from "./auth-machine";

/** True when a code means the server definitively refused this token. */
export function isDefinitiveRejection(error: ApiErrorCode): boolean {
  return error === "unauthenticated" || error === "session_expired" || error === "session_revoked";
}

export interface TokenStore {
  readToken: () => Promise<string | null>;
  writeToken: (token: string) => Promise<boolean>;
  deleteToken: () => Promise<void>;
}

export interface AuthApi {
  fetchSession: (token: string) => Promise<ApiResult<SessionResponse>>;
  login: (input: { email: string; password: string; rememberMe: boolean }) => Promise<ApiResult<LoginResponse>>;
  logout: (token: string) => Promise<ApiResult<{ ok: boolean }>>;
}

export interface AuthFlowDeps {
  store: TokenStore;
  api: AuthApi;
}

/**
 * Cold start. Reads the stored token and asks the server about it.
 *
 * No token → unauthenticated. A definitive rejection → the token is deleted (it can
 * never work again). A network/timeout/config failure → the token is KEPT and the
 * error surfaced, because we do not know that the session is invalid and must not
 * sign the user out on a guess.
 */
export async function bootstrapSession(deps: AuthFlowDeps): Promise<AuthEvent> {
  const token = await deps.store.readToken();
  if (!token) return { type: "BOOT_NO_TOKEN" };

  const result = await deps.api.fetchSession(token);
  if (result.ok) return { type: "BOOT_VALIDATED", session: result.data.session };

  if (isDefinitiveRejection(result.error)) await deps.store.deleteToken();
  return { type: "BOOT_REJECTED", error: result.error };
}

/**
 * Sign in. On success the token is persisted BEFORE success is announced, so a
 * relaunch immediately afterwards finds it. If it cannot be stored securely the
 * sign-in fails: presenting a session we cannot restore — and cannot revoke on
 * logout, having lost the token — would be worse than refusing.
 */
export async function performSignIn(
  deps: AuthFlowDeps,
  credentials: { email: string; password: string; rememberMe: boolean },
): Promise<{ event: AuthEvent; error: ApiErrorCode | null }> {
  const result = await deps.api.login({
    email: credentials.email.trim(),
    password: credentials.password,
    rememberMe: credentials.rememberMe,
  });

  if (!result.ok) {
    return { event: { type: "LOGIN_FAILED", error: result.error }, error: result.error };
  }

  if (!(await deps.store.writeToken(result.data.token))) {
    // Best-effort cleanup: revoke the session we just created but cannot keep.
    try {
      await deps.api.logout(result.data.token);
    } catch {
      /* nothing more we can do; the session will expire on its own */
    }
    return { event: { type: "LOGIN_FAILED", error: "server_error" }, error: "server_error" };
  }

  return { event: { type: "LOGIN_SUCCEEDED", session: result.data.session }, error: null };
}

/**
 * Sign out. Server revocation is attempted first so the token stops working
 * everywhere; local credentials are then cleared UNCONDITIONALLY — a user who asked
 * to sign out must never remain signed in because the network was unavailable.
 *
 * `serverRevoked` is reported truthfully so the UI can say when revocation could
 * not be confirmed rather than implying it succeeded.
 */
export async function performSignOut(
  deps: AuthFlowDeps,
): Promise<{ event: AuthEvent; serverRevoked: boolean }> {
  const token = await deps.store.readToken();
  let serverRevoked = false;

  if (token) {
    const result = await deps.api.logout(token);
    // An already-invalid token is, for our purposes, revoked: it cannot be used.
    serverRevoked = result.ok || isDefinitiveRejection(result.error);
  } else {
    // Nothing stored to revoke — the device is already without credentials.
    serverRevoked = true;
  }

  await deps.store.deleteToken();
  return { event: { type: "SIGNED_OUT" }, serverRevoked };
}

/**
 * Re-ask the server about the current token (foreground return, or an explicit
 * "check again"). Same deletion rule as bootstrap.
 */
export async function revalidateSession(deps: AuthFlowDeps): Promise<AuthEvent> {
  const token = await deps.store.readToken();
  if (!token) return { type: "SESSION_INVALIDATED", error: "unauthenticated" };

  const result = await deps.api.fetchSession(token);
  if (result.ok) return { type: "SESSION_REFRESHED", session: result.data.session };

  if (isDefinitiveRejection(result.error)) await deps.store.deleteToken();
  return { type: "SESSION_INVALIDATED", error: result.error };
}

/**
 * A one-at-a-time gate for a user-triggered async action.
 *
 * Used to make double-submitting the login form impossible: the check and the claim
 * are synchronous, so two taps landing in the same tick cannot both pass — which a
 * piece of React state, updated asynchronously, could not guarantee.
 */
export function createSubmitGuard() {
  let busy = false;
  return {
    /** Claim the slot. Returns false if an attempt is already running. */
    tryAcquire(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    release(): void {
      busy = false;
    },
    get isBusy(): boolean {
      return busy;
    },
  };
}
