/**
 * The authentication state machine.
 *
 * A pure reducer, deliberately separated from React and from I/O, so every
 * transition is directly testable and the rules live in ONE readable place.
 *
 * The central invariant: `authenticated` is reachable ONLY from a server-validated
 * session that is both email-verified and in a supported workspace. A network
 * failure, a timeout, or any ambiguity can never produce it — there is no
 * transition that fabricates an authenticated state.
 */

import type { ApiErrorCode, SessionProfile } from "@/api/types";

export type AuthStatus =
  | "booting"
  | "unauthenticated"
  | "authenticating"
  | "authenticated"
  | "verification_required"
  | "workspace_unsupported"
  | "session_expired"
  | "error";

export type AuthState =
  /** Cold start: reading secure storage and validating with the server. */
  | { status: "booting" }
  /** No usable session. `reason` explains an involuntary sign-out, if any. */
  | { status: "unauthenticated" }
  /** A login request is in flight. Blocks a second submission. */
  | { status: "authenticating" }
  /** Server-validated, verified, supported workspace. The ONLY state that may render `(app)`. */
  | { status: "authenticated"; session: SessionProfile }
  /** Valid session, but the email is not verified — must not enter the app. */
  | { status: "verification_required"; session: SessionProfile }
  /** Valid session in an unknown/unsupported workspace. Fails closed. */
  | { status: "workspace_unsupported"; session: SessionProfile }
  /** A previously working session was rejected. Distinct so the UI can say so. */
  | { status: "session_expired" }
  /** A bounded, recoverable failure worth showing (config, network at boot). */
  | { status: "error"; error: ApiErrorCode };

export type AuthEvent =
  /** Cold start found no stored token. */
  | { type: "BOOT_NO_TOKEN" }
  /** The server validated the stored token. */
  | { type: "BOOT_VALIDATED"; session: SessionProfile }
  /** The server rejected the stored token, or boot failed. */
  | { type: "BOOT_REJECTED"; error: ApiErrorCode }
  | { type: "LOGIN_STARTED" }
  | { type: "LOGIN_SUCCEEDED"; session: SessionProfile }
  | { type: "LOGIN_FAILED"; error: ApiErrorCode }
  /** An authenticated request found the session no longer valid. */
  | { type: "SESSION_INVALIDATED"; error: ApiErrorCode }
  /** A revalidation returned a fresh profile (e.g. email now verified). */
  | { type: "SESSION_REFRESHED"; session: SessionProfile }
  /** Local + server sign-out finished. */
  | { type: "SIGNED_OUT" };

export const initialAuthState: AuthState = { status: "booting" };

/**
 * Classify a server-validated session.
 *
 * Order matters: verification is checked before workspace, matching the web flow
 * where an unverified user is sent to /verify-email before any workspace routing.
 * An unknown or unsupported workspace FAILS CLOSED — it never falls through to
 * Business, and it never reaches `authenticated`.
 */
export function stateForSession(session: SessionProfile): AuthState {
  if (!session.emailVerified) return { status: "verification_required", session };
  if (session.workspace !== "business" && session.workspace !== "family") {
    return { status: "workspace_unsupported", session };
  }
  return { status: "authenticated", session };
}

/**
 * Where a rejection lands. `session_expired` is surfaced as its own state so the
 * login screen can truthfully say the session ended rather than implying the user
 * did something wrong; a plain `unauthenticated` (no token, or never signed in) is
 * silent.
 */
function stateForRejection(error: ApiErrorCode): AuthState {
  if (error === "session_expired" || error === "session_revoked") return { status: "session_expired" };
  if (error === "unauthenticated") return { status: "unauthenticated" };
  // config / network / timeout / server_error at BOOT time: we genuinely do not
  // know whether the session is valid, so we must not claim it is. Surfacing the
  // error (rather than silently signing out) lets the user retry without
  // re-entering credentials once connectivity returns.
  return { status: "error", error };
}

export function authReducer(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case "BOOT_NO_TOKEN":
      return { status: "unauthenticated" };

    case "BOOT_VALIDATED":
      return stateForSession(event.session);

    case "BOOT_REJECTED":
      return stateForRejection(event.error);

    case "LOGIN_STARTED":
      // Guard against a double submission: a login already in flight wins.
      return state.status === "authenticating" ? state : { status: "authenticating" };

    case "LOGIN_SUCCEEDED":
      return stateForSession(event.session);

    case "LOGIN_FAILED":
      // A failed login returns to the login screen; the error itself is rendered by
      // the form, not held as machine state, so it clears on the next attempt.
      return { status: "unauthenticated" };

    case "SESSION_REFRESHED":
      return stateForSession(event.session);

    case "SESSION_INVALIDATED":
      // Only a definitive server rejection may sign the user out. A network blip
      // must NOT — the app keeps its last validated state and retries later.
      if (event.error === "network" || event.error === "timeout") return state;
      return event.error === "unauthenticated" ? { status: "unauthenticated" } : { status: "session_expired" };

    case "SIGNED_OUT":
      return { status: "unauthenticated" };

    default:
      return state;
  }
}

/** The one predicate that gates the `(app)` route group. */
export function canEnterApp(state: AuthState): boolean {
  return state.status === "authenticated";
}

/** True while the app must show a boot screen rather than any route. */
export function isBooting(state: AuthState): boolean {
  return state.status === "booting";
}

/** The session profile, when the state carries one. */
export function sessionOf(state: AuthState): SessionProfile | null {
  return "session" in state ? state.session : null;
}
