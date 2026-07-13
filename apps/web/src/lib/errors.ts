/**
 * V1.39 — normalized, SAFE user-facing errors. Every user-visible failure maps to one
 * of these reasons with a friendly message + remediation. NEVER carries a stack trace,
 * Prisma/Postgres error, DB role, SQL, token or any secret. A short correlation id lets
 * support tie a user report to server logs without exposing internals.
 */
export type SafeErrorReason =
  | "unauthenticated"
  | "permission_denied"
  | "not_found"
  | "tenant_access_denied"
  | "connector_unavailable"
  | "permission_missing"
  | "token_expired"
  | "reconnect_required"
  | "sync_locked"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_verification_pending"
  | "database_runtime_misconfigured"
  | "unexpected_error";

export interface SafeError {
  reason: SafeErrorReason;
  title: string;
  message: string;
  remediation: string;
}

export const SAFE_ERRORS: Record<SafeErrorReason, Omit<SafeError, "reason">> = {
  unauthenticated: { title: "Please sign in", message: "Your session has ended or you are not signed in.", remediation: "Sign in again to continue." },
  permission_denied: { title: "Not allowed", message: "Your role does not permit this action.", remediation: "Ask a workspace owner or admin for access." },
  not_found: { title: "Not found", message: "This page or item does not exist, or you do not have access to it.", remediation: "Go back to your dashboard." },
  tenant_access_denied: { title: "No access", message: "This item belongs to a different workspace.", remediation: "Switch to the correct workspace, or go back." },
  connector_unavailable: { title: "Connection unavailable", message: "This connected account can't be reached right now.", remediation: "Check the account's status on the Accounts page." },
  permission_missing: { title: "Extra permissions needed", message: "The connected account is missing a permission required for this.", remediation: "Reconnect the account and grant the requested permissions." },
  token_expired: { title: "Reconnect required", message: "The access token for this account has expired.", remediation: "Reconnect the account to continue monitoring." },
  reconnect_required: { title: "Reconnect required", message: "This account needs to be reconnected.", remediation: "Use “Reconnect” on the account to restore access." },
  sync_locked: { title: "Sync already running", message: "A sync for this account is already in progress.", remediation: "Wait for it to finish, then try again." },
  rate_limited: { title: "Slow down", message: "The platform temporarily rate-limited this request.", remediation: "This retries automatically — try again shortly." },
  provider_unavailable: { title: "Platform unavailable", message: "The platform's API is temporarily unavailable.", remediation: "This is usually transient — try again later." },
  provider_verification_pending: { title: "Not live yet", message: "This provider is implemented but awaiting real provider verification.", remediation: "No action needed — it becomes available once verification completes." },
  database_runtime_misconfigured: { title: "Service unavailable", message: "The service is temporarily unavailable due to a configuration issue.", remediation: "Please try again shortly. If it persists, contact support with the id below." },
  unexpected_error: { title: "Something went wrong", message: "An unexpected error occurred. Nothing sensitive was exposed.", remediation: "Try again. If it keeps happening, contact support with the id below." },
};

export function toSafeError(reason: SafeErrorReason): SafeError {
  return { reason, ...SAFE_ERRORS[reason] };
}

/** Short, non-secret correlation id (safe to show a user + log server-side). */
export function newCorrelationId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `t_${uuid.replace(/-/g, "").slice(0, 12)}`;
}
