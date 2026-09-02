/**
 * Wire types for the Tamanor mobile API.
 *
 * These mirror `apps/web/src/server/mobile-auth.ts` exactly. If the server view
 * changes, change it here too — there is no code generation between them yet.
 */

/** Where the server says this account belongs. `unsupported` must FAIL CLOSED. */
export type Workspace = "business" | "family" | "unsupported";

/**
 * The account context the server returns. Display and routing data only — the
 * server deliberately sends no user id, tenant id or session id, because identity
 * is re-resolved from the bearer token on every request.
 */
export interface SessionProfile {
  userName: string;
  userEmail: string;
  emailVerified: boolean;
  tenantName: string;
  role: string;
  workspace: Workspace;
  /** ISO-8601. For display only — the server enforces expiry. */
  expiresAt: string;
  rememberMe: boolean;
}

/**
 * The bounded error vocabulary the app understands.
 *
 * `network` / `timeout` / `config` are client-side conditions; the rest mirror the
 * server's codes. Anything unrecognised collapses to `server_error`, so a raw
 * server string can never reach the UI.
 */
export type ApiErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "rate_limited"
  | "challenge_required"
  | "unauthenticated"
  | "session_expired"
  | "session_revoked"
  | "server_error"
  | "network"
  | "timeout"
  | "config";

/** Every API call returns this — callers must handle both arms. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorCode };

export interface LoginResponse {
  token: string;
  session: SessionProfile;
}

export interface SessionResponse {
  session: SessionProfile;
}
