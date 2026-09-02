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

/* -------------------------------------------------------------------------- */
/* M3 — app shell + dashboard                                                  */
/* -------------------------------------------------------------------------- */

/** Mobile navigation destinations the server may allow. Mirrors `MobileNavKey`. */
export type NavKey =
  | "overview" | "comments" | "accounts" | "alerts"
  | "activity" | "rules" | "billing" | "settings" | "team";

/** Truthful account-state banner. Mirrors `MobileAccessBanner`. */
export type AccessBanner = "restricted" | "past_due" | "trial_ending";

/** Watched-account state. Mirrors `MobileAccountStatus`. */
export type AccountStatus =
  | "active" | "permissions_expired" | "sync_failed" | "monitoring_off" | "demo";

/** Bounded activity events. Mirrors `MobileActivityType`. */
export type ActivityType =
  | "sync.completed" | "sync.failed" | "auto_protect.would_auto_hide"
  | "protection.action_executed" | "incident.created" | "proposal.created"
  | "account.connected" | "token.expired";

/** Aggregate protection check state. Mirrors `MobileCheckState`. */
export type CheckState = "ok" | "partial" | "off";

/** The only timeframes the dashboard accepts. */
export const TIMEFRAMES = [7, 30, 90] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface Bootstrap {
  user: { name: string; email: string };
  workspace: { name: string; kind: Workspace; demo: boolean };
  role: string;
  access: {
    state: string;
    billingStatus: string;
    trialDaysLeft: number | null;
    planName: string | null;
    banner: AccessBanner | null;
    /** False for restricted/suspended — hide write affordances (server still enforces). */
    canWrite: boolean;
  };
  usage: {
    /** `limit: null` means unlimited on this plan. */
    processedItems: { used: number; limit: number | null };
    accounts: { used: number; limit: number | null };
  };
  counts: { pendingReview: number; unreadNotifications: number };
  /** UX affordance ONLY — hiding a tab never protects an endpoint. */
  nav: { allowed: NavKey[] };
  generatedAt: string;
}

export interface WatchedAccount {
  id: string;
  platform: string;
  name: string | null;
  status: AccountStatus;
  comments: number;
  risky: number;
  autoHideEnabled: boolean;
  monitoringEnabled: boolean;
  lastSyncAt: string | null;
}

export interface Dashboard {
  timeframe: Timeframe;
  generatedAt: string;
  isEmpty: boolean;
  realTestMode: boolean;
  overview: {
    analyzedComments: number;
    riskComments: number;
    autoHandled: number;
    pendingReview: number;
    accountsWithProblem: number;
  };
  /** null = no honest baseline for that metric. Never render a fabricated 0%. */
  deltas: {
    analyzedComments: number | null;
    riskComments: number | null;
    autoHandled: number | null;
  };
  watchedAccounts: WatchedAccount[];
  watchedAccountsTotal: number;
  protection: { score: number; checks: { key: string; state: CheckState }[] } | null;
  riskTrend: {
    buckets: { key: string; count: number }[];
    total: number;
    categories: { category: string; count: number }[];
  };
  recentActivity: { id: string; type: ActivityType; at: string }[];
}

export interface BootstrapResponse { bootstrap: Bootstrap }
export interface DashboardResponse { dashboard: Dashboard }
