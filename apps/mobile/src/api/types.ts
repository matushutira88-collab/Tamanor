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

/* -------------------------------------------------------------------------- */
/* M4 — Inbox                                                                  */
/* -------------------------------------------------------------------------- */

export const INBOX_VIEWS = ["default", "unread", "archived", "assigned_me", "unassigned"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const INBOX_RANGES = ["all", "today", "7d", "30d"] as const;
export type InboxRange = (typeof INBOX_RANGES)[number];

export const INBOX_TYPES = ["comment", "review"] as const;
export type InboxType = (typeof INBOX_TYPES)[number];

export const INBOX_SENTIMENTS = ["positive", "neutral", "negative", "risky"] as const;
export type InboxSentiment = (typeof INBOX_SENTIMENTS)[number];

export const INBOX_WORKFLOWS = ["new", "in_review", "action_required", "resolved"] as const;
export type InboxWorkflow = (typeof INBOX_WORKFLOWS)[number];

export const INBOX_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type InboxPriority = (typeof INBOX_PRIORITIES)[number];

export const INBOX_RISKS = ["none", "low", "medium", "high", "critical"] as const;
export type InboxRisk = (typeof INBOX_RISKS)[number];

export const INBOX_ACTION_STATES = [
  "deleted", "hidden", "cannot_hide", "pending", "monitored", "no_action", "kept", "captured",
] as const;
export type InboxActionState = (typeof INBOX_ACTION_STATES)[number];

export const INBOX_PROCESSING_STATES = [
  "pending", "processed_rules", "processed_local", "processed_paid", "cached",
  "basic_limit_reached", "premium_limit_reached", "paid_ai_disabled", "failed",
] as const;
export type InboxProcessing = (typeof INBOX_PROCESSING_STATES)[number];

export const CONNECTOR_HEALTH_STATES = [
  "healthy", "verification_pending", "rate_limited", "permission_missing",
  "disconnected", "api_unavailable", "error",
] as const;
export type ConnectorHealth = (typeof CONNECTOR_HEALTH_STATES)[number];

export const CLASSIFICATION_STATES = ["confirmed", "review_required", "no_issue"] as const;
export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];

export const INBOX_AUDIT_EVENTS = [
  "inbox.mark_read", "inbox.mark_unread", "inbox.archive", "inbox.unarchive",
  "inbox.set_priority", "inbox.set_workflow_status", "inbox.assign", "inbox.unassign",
  "inbox.label_assign", "inbox.label_remove", "inbox.note_add",
] as const;
export type InboxAuditEvent = (typeof INBOX_AUDIT_EVENTS)[number];

/** The internal actions mobile may request. Provider writes are deliberately absent. */
export type InboxActionKey = "read" | "unread" | "archive" | "unarchive" | "priority" | "workflow";

export interface InboxLabel {
  id: string;
  name: string;
  colorKey: string;
}

export interface InboxItem {
  id: string;
  type: InboxType;
  preview: string | null;
  author: string | null;
  platform: string;
  account: string | null;
  createdAt: string;
  permalink: string | null;
  rating: number | null;
  sentiment: InboxSentiment;
  /** Customer-visible severity, already safe-capped by the server. */
  risk: InboxRisk;
  classification: ClassificationState;
  categories: string[];
  requiresReanalysis: boolean;
  isRead: boolean;
  archived: boolean;
  priority: InboxPriority;
  workflow: InboxWorkflow;
  assignee: { id: string; name: string } | null;
  labels: InboxLabel[];
  noteCount: number;
  actionState: InboxActionState;
  processing: InboxProcessing;
  connectorHealth: ConnectorHealth;
}

export interface InboxItemDetail extends InboxItem {
  text: string | null;
  notes: { id: string; body: string; authorName: string | null; createdAt: string }[];
  activity: { id: string; event: InboxAuditEvent; at: string }[];
}

export interface InboxCounts {
  total: number;
  unread: number;
  archived: number;
  assigned: number;
  unassigned: number;
}

/** Everything the client may send. Deliberately has no tenant/user/role field. */
export interface InboxFilters {
  view: InboxView;
  range: InboxRange;
  type: InboxType | null;
  sentiment: InboxSentiment | null;
  workflow: InboxWorkflow | null;
  priority: InboxPriority | null;
  risk: InboxRisk | null;
  provider: string | null;
  label: string | null;
  assignee: string | null;
  q: string | null;
}

export interface InboxListResponse {
  items: InboxItem[];
  page: { nextCursor: string | null; hasMore: boolean };
  counts: InboxCounts;
  applied: InboxFilters & { cursor: string | null };
  /** Server's verdict on whether this role may mutate. UX only — the server re-checks. */
  canAct: boolean;
}

export interface InboxDetailResponse {
  item: InboxItemDetail;
  canAct: boolean;
}

export interface InboxActionResponse {
  ok: boolean;
  /** Fresh canonical state for the mutated row, or null if it could not be re-read. */
  item: InboxItem | null;
}

export interface InboxOptions {
  platforms: string[];
  labels: InboxLabel[];
  members: { id: string; name: string }[];
}

export interface InboxOptionsResponse {
  options: InboxOptions;
}
