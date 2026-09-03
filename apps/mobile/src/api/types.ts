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
  /** The item does not exist, or belongs to another tenant — deliberately the same. */
  | "not_found"
  /** The role lacks the required permission. The screen stays readable. */
  | "permission_denied"
  /** Access is read-only (restricted/suspended tenant). */
  | "read_only"
  /** Another operator changed the item first; the server returns canonical state. */
  | "conflict"
  /** The plan's monitored-account limit is already reached. */
  | "account_limit_reached"
  /** The session is valid but the workspace is not one this app supports. */
  | "workspace_unsupported"
  /** The account is verified-email gated. */
  | "verification_required"
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

/* -------------------------------------------------------------------------- */
/* M5 — Action Queue                                                           */
/* -------------------------------------------------------------------------- */

export const QUEUE_TABS = ["active", "approval", "blocked", "resolved", "all"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export const QUEUE_STATES = [
  "suggested", "approval_required", "approved", "rejected", "blocked_by_safety",
  "dry_run", "executed", "failed", "rollback_needed", "monitor", "no_action",
] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export const PROPOSED_ACTIONS = [
  "notify", "create_inbox_item", "suggest_reply", "request_approval", "hide_comment",
  "report", "escalate", "assign_to_user", "create_incident", "no_action",
] as const;
export type ProposedAction = (typeof PROPOSED_ACTIONS)[number];

export const EXECUTION_STATUSES = [
  "blocked", "dry_run", "executed", "failed", "rollback_pending", "rolled_back",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type ExecutionTrigger = "approval" | "autonomous";

export const QUEUE_REASONS = [
  "global_disabled", "facebook_hide_disabled", "unsupported_platform", "account_is_demo",
  "account_not_active", "reconnect_required", "token_not_healthy", "token_expired",
  "unhealthy_account", "missing_permission", "safety_never_autonomous",
  "category_not_eligible", "policy_not_autonomous", "low_confidence",
  "threat_requires_critical", "missing_comment_id",
  "dry_run_mode", "dry_run_still_enabled", "live_not_enabled", "live_confirm_required",
  "already_executed", "comment_deleted_or_unavailable", "provider_error", "unavailable",
] as const;
export type QueueReason = (typeof QUEUE_REASONS)[number];

export const READINESS_STATES = ["blocked", "dry_run", "live_possible", "already_executed", "not_applicable"] as const;
export type Readiness = (typeof READINESS_STATES)[number];

export const LIFECYCLE_STATES = ["visible", "hidden", "deleted", "cannot_hide", "unknown"] as const;
export type Lifecycle = (typeof LIFECYCLE_STATES)[number];

export type PolicyMode = "monitor" | "assist" | "approval" | "autonomous";

export const QUEUE_AUDIT_EVENTS = [
  "approval.approved", "approval.rejected", "approval.resolved", "approval.retried",
  "platform_action.live_requested", "platform_action.executed", "platform_action.blocked",
  "feedback.created", "incident.created",
] as const;
export type QueueAuditEvent = (typeof QUEUE_AUDIT_EVENTS)[number];

/** The INTERNAL decisions the app may request. Provider actions are absent by design. */
export const QUEUE_DECISIONS = ["approve", "reject", "resolve"] as const;
export type QueueDecision = (typeof QUEUE_DECISIONS)[number];

export interface QueueExecution {
  status: ExecutionStatus;
  trigger: ExecutionTrigger;
  reason: QueueReason | null;
  at: string;
}

export interface QueueItem {
  id: string;
  relatedInboxItemId: string | null;
  proposedAction: ProposedAction;
  queueState: QueueState;
  category: string;
  reason: QueueReason | null;
  createdAt: string;
  contentPreview: string | null;
  contentType: "comment" | "review" | null;
  author: string | null;
  platform: string | null;
  account: string | null;
  rating: number | null;
  risk: string | null;
  execution: QueueExecution | null;
  lifecycle: Lifecycle;
  /** UX affordances. The server re-checks all of them on every mutation. */
  canApprove: boolean;
  canReject: boolean;
  canResolve: boolean;
}

export interface QueueItemDetail extends QueueItem {
  contentText: string | null;
  confidence: number | null;
  policy: { mode: PolicyMode | null; neverAutonomous: boolean; autonomousEligible: boolean };
  /** INFORMATION ONLY — M5 exposes no live-execution control. */
  readiness: { state: Readiness; reason: QueueReason | null };
  executions: QueueExecution[];
  activity: { id: string; event: QueueAuditEvent; at: string }[];
}

export interface QueueCounts {
  active: number;
  approval: number;
  blocked: number;
}

export interface QueueListResponse {
  items: QueueItem[];
  page: { nextCursor: string | null; hasMore: boolean };
  counts: QueueCounts;
  tab: QueueTab;
  canDecide: boolean;
}

export interface QueueDetailResponse {
  item: QueueItemDetail;
  canDecide: boolean;
}

export interface QueueDecisionResponse {
  ok: boolean;
  item: QueueItem | null;
  counts: QueueCounts | null;
}

/** 409 payload — the canonical current state after losing a race. */
export interface QueueConflictResponse {
  error: "conflict";
  item: QueueItem | null;
}

/* -------------------------------------------------------------------------- */
/* M6 — Accounts                                                               */
/* -------------------------------------------------------------------------- */

/**
 * THE FOUR SEPARATE TRUTHS.
 *
 *   CONNECTION HEALTH ≠ MONITORING ≠ AUTO-SYNC ≠ PROVIDER ACTION CAPABILITY
 *
 * They arrive as four independent fields and the client must keep them apart. There
 * is deliberately no combined "status" field to render, and only `connectionState`
 * may ever drive a success/green treatment.
 */

/** Canonical `ConnectionState` (@guardora/core). Only CONNECTED_HEALTHY may be green. */
export const CONNECTION_STATES = [
  "CONNECTED_HEALTHY", "WAITING_FIRST_SYNC", "DEGRADED",
  "REAUTH_REQUIRED", "SYNC_FAILED", "DISCONNECTED",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/** Canonical `AutoSyncState`. */
export const AUTO_SYNC_STATES = [
  "ENABLED_HEALTHY", "ENABLED_DEGRADED", "ENABLED_REAUTH_REQUIRED",
  "DISABLED", "NOT_CONFIGURED",
] as const;
export type AutoSyncState = (typeof AUTO_SYNC_STATES)[number];

/** Canonical `FirstSyncState`. A never-synced account is waiting, not failed. */
export const FIRST_SYNC_STATES = ["waiting_first_sync", "syncing", "synced", "failed"] as const;
export type FirstSyncState = (typeof FIRST_SYNC_STATES)[number];

export const ACCOUNT_KINDS = ["real", "read_only", "test"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Canonical platforms plus an explicit `unknown`. A new platform never becomes Facebook. */
export const ACCOUNT_PLATFORMS = [
  "facebook_page", "instagram_business", "youtube",
  "linkedin_company", "tiktok", "google_business", "unknown",
] as const;
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number];

/** Token PRESENTATION only. No token, fragment or expiry secret ever reaches the app. */
export const TOKEN_HEALTHS = ["unknown", "ok", "expiring_soon", "expired", "invalid", "revoked"] as const;
export type TokenHealth = (typeof TOKEN_HEALTHS)[number];

export const ACCOUNT_REASONS = [
  "token_expired", "permission_missing", "provider_unavailable", "rate_limited",
  "sync_failed", "reconnect_required", "no_token", "disconnected",
  "credential_persist_failed", "instagram_disconnected", "account_not_discoverable",
  "unknown",
] as const;
export type AccountReason = (typeof ACCOUNT_REASONS)[number];

export const SYNC_RUN_STATUSES = [
  "running", "completed", "failed", "partial_success", "skipped_locked",
  "disconnected", "permission_missing", "rate_limited", "api_unavailable", "interrupted",
] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

export const CAPABILITY_STATES = [
  "available", "unavailable", "not_implemented", "not_configured",
  "missing_permission", "requires_web", "blocked_by_safety",
] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/** Bounded outcome of a manual sync. `started` never means "finished". */
export const SYNC_RESULTS = [
  "started", "already_running", "reconnect_required", "not_supported", "not_found",
] as const;
export type SyncResult = (typeof SYNC_RESULTS)[number];

export const REVOKE_RESULTS = ["revoked", "unsupported", "already_invalid", "failed"] as const;
export type RevokeResult = (typeof REVOKE_RESULTS)[number];

export interface AccountCapabilities {
  canRead: CapabilityState;
  canSync: CapabilityState;
  canMonitor: CapabilityState;
  canReconnect: CapabilityState;
  canDisconnect: CapabilityState;
  moderationState: CapabilityState;
  replyState: CapabilityState;
}

export interface ConnectedAccountItem {
  id: string;
  platform: AccountPlatform;
  platformLabel: string;
  name: string | null;
  username: string | null;
  accountKind: AccountKind;

  /** TRUTH 1 */
  connectionState: ConnectionState;
  needsReconnect: boolean;
  reason: AccountReason | null;

  /** TRUTH 2 */
  monitoringEnabled: boolean;
  monitoringCanBeEnabled: boolean;

  /** TRUTH 3 */
  autoSyncState: AutoSyncState;
  firstSyncState: FirstSyncState;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;

  commentsToday: number;
  riskToday: number;

  /** TRUTH 4. UX affordances only — the server re-checks every one of them. */
  capabilities: AccountCapabilities;
  canManage: boolean;
}

export interface SyncRunItem {
  id: string;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  fetched: number;
  created: number;
  reason: AccountReason | null;
  demo: boolean;
}

export interface ConnectedAccountDetail extends ConnectedAccountItem {
  tokenHealth: TokenHealth;
  tokenExpiresAt: string | null;
  lastSuccessfulProviderCheckAt: string | null;
  /** Display only — M6 exposes no kill-switch control. */
  protectionPaused: boolean;
  brandName: string | null;
  syncRuns: SyncRunItem[];
}

export interface AccountCapacity {
  used: number;
  /** `-1` means unlimited. */
  limit: number;
  remaining: number;
  monitored: number;
}

export interface AccountsListResponse {
  accounts: ConnectedAccountItem[];
  capacity: AccountCapacity;
  capabilities: { canManageConnectors: boolean };
  needsAttention: number;
}

export interface AccountDetailResponse {
  account: ConnectedAccountDetail;
  capacity: AccountCapacity;
  capabilities: { canManageConnectors: boolean };
}

export interface MonitoringResponse {
  account: ConnectedAccountItem;
  capacity: AccountCapacity;
}

export interface AccountSyncResponse {
  result: SyncResult;
}

export interface AccountDisconnectResponse {
  disconnected: boolean;
  /** A COUNT of the local accounts that shared these credentials — never their ids. */
  clusterCount: number;
  clusterPlatforms: AccountPlatform[];
  providerRevoke: RevokeResult;
  manualCleanupRecommended: boolean;
}

/* -------------------------------------------------------------------------- */
/* M7 — native connector OAuth                                                 */
/* -------------------------------------------------------------------------- */

/**
 * THE DEEP LINK IS NOT AUTHORITATIVE.
 *
 * `tamanor://oauth/callback?flow=…` means only "the auth browser returned; ask the
 * server what happened". Every type below describes a SERVER answer fetched with
 * the bearer — none of it may be constructed from a deep link.
 */

export const OAUTH_PROVIDERS = ["meta", "google_business"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_INTENTS = ["connect", "reconnect"] as const;
export type OAuthIntent = (typeof OAUTH_INTENTS)[number];

/**
 * Flow lifecycle. `selection_required` is a real state: the provider authorized
 * Tamanor, but nothing is connected until the user picks Pages or locations.
 */
export const OAUTH_STATUSES = [
  "pending", "provider_pending", "selection_required",
  "completed", "failed", "cancelled", "expired",
] as const;
export type OAuthStatus = (typeof OAUTH_STATUSES)[number];

/** Bounded failure vocabulary. Raw provider text never reaches the app. */
export const OAUTH_RESULT_CODES = [
  "user_cancelled", "invalid_state", "expired", "permission_denied",
  "account_limit_reached", "brand_platform_limit_reached", "provider_unavailable",
  "token_exchange_failed", "missing_permission", "no_accounts", "selection_required",
  "save_failed", "not_found", "session_invalid", "unknown",
] as const;
export type OAuthResultCode = (typeof OAUTH_RESULT_CODES)[number];

/**
 * Provider availability. Three booleans — no client id, redirect URI or scope list,
 * because the app never builds a provider URL itself.
 */
export interface OAuthProviderAvailability {
  provider: OAuthProvider;
  configured: boolean;
  available: boolean;
  approved: boolean;
}

export interface OAuthProvidersResponse {
  providers: OAuthProviderAvailability[];
  /** Connect targets. The id is a hint; the server re-validates it. */
  brands: { id: string; name: string }[];
  canManageConnectors: boolean;
}

export interface OAuthStartResponse {
  flowId: string;
  /**
   * The PROVIDER's authorization URL, built server-side. It carries normal OAuth
   * parameters and never a Tamanor bearer, session token or client secret.
   */
  authorizationUrl: string;
  expiresAt: string;
}

export interface OAuthFlow {
  id: string;
  provider: OAuthProvider;
  intent: OAuthIntent;
  status: OAuthStatus;
  expiresAt: string;
  resultCode: OAuthResultCode | null;
  accountId: string | null;
  selectionRequired: boolean;
}

/** One selectable provider asset. Carries no token and no provider credential. */
export interface OAuthSelectableOption {
  /** The canonical selection value the server validates against. */
  id: string;
  displayName: string;
  kind: string;
  alreadyConnected: boolean;
  eligible: boolean;
  reason: string | null;
}

export interface OAuthOptionsResponse {
  flowId: string;
  provider: OAuthProvider;
  options: OAuthSelectableOption[];
}

export interface OAuthSelectResponse {
  flowId: string;
  status: OAuthStatus;
  connected: number;
  monitored: number;
  limited: number;
  slotTaken: number;
  /** Submitted ids matching no server asset. A COUNT — never the value. */
  rejected: number;
  accountIds: string[];
  resultCode: OAuthResultCode | null;
}
