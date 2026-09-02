/**
 * M3 — native app-shell bootstrap + Business dashboard read API.
 *
 * Mirrors the web dashboard's server truth rather than re-deriving it:
 * `apps/web/src/app/dashboard/layout.tsx` supplies the shell semantics (verified
 * session → business-only workspace → billing/entitlements/counters → server-side
 * nav gate) and `apps/web/src/app/dashboard/page.tsx` supplies the dashboard
 * semantics (KPIs, honest deltas, watched accounts, aggregate protection, risk
 * trend, bounded activity, empty-workspace onboarding).
 *
 * Everything is injected and this module imports no runtime value (types only), so
 * the whole request lifecycle is unit-testable without a database or network.
 *
 * WIRE CONTRACT: the client receives BOUNDED KEYS, never prose. Account statuses,
 * activity types and protection checks cross the wire as enum keys that the app
 * localizes itself, so a raw database value or internal event name can never be
 * rendered. No DB rows, no secrets, no session token, no audit metadata.
 *
 * AUTHORIZATION: navigation data here is a UX affordance ONLY. Every endpoint
 * independently re-resolves the session, re-checks email verification, re-checks
 * the workspace kind, and derives the tenant from the session — never from the
 * client.
 */

import type { ResolvedSession, SessionRejectReason, WatchedAccountView } from "@guardora/db";
import type { OpsEvent } from "@guardora/core";

/* -------------------------------------------------------------------------- */
/* Bounded vocabularies                                                        */
/* -------------------------------------------------------------------------- */

/** Mobile navigation destinations. Deliberately smaller than the web sidebar. */
export type MobileNavKey =
  | "overview" | "comments" | "accounts" | "alerts"
  | "activity" | "rules" | "billing" | "settings" | "team";

/** Web href each mobile destination corresponds to, for the server-side RBAC gate. */
export const MOBILE_NAV_HREFS: Record<MobileNavKey, string> = {
  overview: "/dashboard",
  comments: "/dashboard/comments",
  accounts: "/dashboard/accounts",
  alerts: "/dashboard/action-queue",
  activity: "/dashboard/timeline",
  rules: "/dashboard/control-center",
  billing: "/dashboard/billing",
  settings: "/dashboard/settings",
  team: "/dashboard/team",
};

export const MOBILE_NAV_KEYS = Object.keys(MOBILE_NAV_HREFS) as MobileNavKey[];

/**
 * Watched-account state. Mirrors `accountBadge` in the web dashboard page:
 * `needs_reconnect` and `permissions_expired` collapse to one user-facing state
 * (both mean "reconnect required"), and `sync_failed` is surfaced as its own key
 * so the cause stays truthful even though the web labels it "Needs attention".
 */
export type MobileAccountStatus =
  | "active" | "permissions_expired" | "sync_failed" | "monitoring_off" | "demo";

/** Bounded activity events — exactly the set the web dashboard queries for. */
export const MOBILE_ACTIVITY_TYPES = [
  "sync.completed", "sync.failed", "auto_protect.would_auto_hide",
  "protection.action_executed", "incident.created", "proposal.created",
  "account.connected", "token.expired",
] as const;
export type MobileActivityType = (typeof MOBILE_ACTIVITY_TYPES)[number];

/** Aggregate protection check state — same three-way as the web `CheckState`. */
export type MobileCheckState = "ok" | "partial" | "off";

/** The only timeframes the dashboard accepts. */
export const MOBILE_TIMEFRAMES = [7, 30, 90] as const;
export type MobileTimeframe = (typeof MOBILE_TIMEFRAMES)[number];
export const DEFAULT_TIMEFRAME: MobileTimeframe = 30;

/** Truthful account-state banner, mirroring the web `StateBanner`. */
export type MobileAccessBanner = "restricted" | "past_due" | "trial_ending";

export type MobileShellError =
  | "unauthenticated" | "session_expired" | "session_revoked"
  | "verification_required" | "workspace_unsupported"
  | "invalid_request" | "server_error";

export interface MobileShellResponse {
  status: number;
  body: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* DTOs                                                                        */
/* -------------------------------------------------------------------------- */

export interface MobileBootstrap {
  user: { name: string; email: string };
  workspace: { name: string; kind: "business" | "family" | "unsupported"; demo: boolean };
  role: string;
  access: {
    state: string;
    billingStatus: string;
    trialDaysLeft: number | null;
    planName: string | null;
    /** null when nothing needs saying. */
    banner: MobileAccessBanner | null;
    /** False for restricted/suspended: the app must not offer write actions. */
    canWrite: boolean;
  };
  usage: {
    /** `limit: null` means UNLIMITED on this plan — not "unknown", and not zero. */
    processedItems: { used: number; limit: number | null };
    accounts: { used: number; limit: number | null };
  };
  counts: { pendingReview: number; unreadNotifications: number };
  /** UX affordance ONLY — never an authorization decision. */
  nav: { allowed: MobileNavKey[] };
  generatedAt: string;
}

export interface MobileKpiDeltas {
  /** Percent change vs. the previous window, or null when there is no honest baseline. */
  analyzedComments: number | null;
  riskComments: number | null;
  autoHandled: number | null;
}

export interface MobileWatchedAccount {
  id: string;
  platform: string;
  name: string | null;
  status: MobileAccountStatus;
  comments: number;
  risky: number;
  autoHideEnabled: boolean;
  monitoringEnabled: boolean;
  lastSyncAt: string | null;
}

export interface MobileTrendBucket {
  key: string;
  count: number;
}

export interface MobileDashboard {
  timeframe: MobileTimeframe;
  generatedAt: string;
  /** True when the workspace has no accounts AND no analyzed comments — show onboarding. */
  isEmpty: boolean;
  /** GUARDORA_DATA_MODE=real — the web dashboard shows a test-mode notice for this. */
  realTestMode: boolean;
  overview: {
    analyzedComments: number;
    riskComments: number;
    autoHandled: number;
    pendingReview: number;
    accountsWithProblem: number;
  };
  deltas: MobileKpiDeltas;
  watchedAccounts: MobileWatchedAccount[];
  /** Total before the dashboard slice, so the app can say "showing 6 of N". */
  watchedAccountsTotal: number;
  /** null when no account is monitored — the web hides the card entirely then. */
  protection: {
    score: number;
    checks: { key: string; state: MobileCheckState }[];
  } | null;
  riskTrend: {
    buckets: MobileTrendBucket[];
    total: number;
    categories: { category: string; count: number }[];
  };
  recentActivity: { id: string; type: MobileActivityType; at: string }[];
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

export interface ShellSessionDeps {
  readUserSession: (
    token: string | null | undefined,
  ) => Promise<{ ok: boolean; session?: ResolvedSession; reason?: SessionRejectReason }>;
  classifyWorkspace: (kind: unknown) => "business" | "family" | "unsupported";
  emitOpsEvent: (event: OpsEvent, meta?: Record<string, unknown>) => void;
  now?: () => Date;
}

export interface BootstrapDeps extends ShellSessionDeps {
  getTenantBilling: (tenantId: string) => Promise<{
    accessState?: string | null;
    billingStatus?: string | null;
    trialEndsAt?: Date | null;
    plan?: string | null;
    subscription?: { plan?: string | null } | null;
  } | null>;
  /** Plan entitlements. A `null` cap means unlimited (see `PlanEntitlements`). */
  getTenantEntitlements: (tenantId: string) => Promise<{
    monthlyProcessedItems: number | null;
    maxConnectedAccounts: number | null;
  }>;
  getShellCounters: (tenantId: string) => Promise<{
    processedItemsUsed: number;
    pendingReview: number;
    accountsUsed: number;
  }>;
  unreadNotificationCount: (tenantId: string, userId: string) => Promise<number>;
  /** Server-side RBAC + workspace nav gate (`computeDeniedNavHrefs`). */
  deniedNavHrefs: (opts: { role: string; workspaceKind: string }) => string[];
}

export interface DashboardDeps extends ShellSessionDeps {
  loadDashboard: (input: {
    tenantId: string;
    since: Date;
    prevSince: Date;
  }) => Promise<RawDashboardData>;
}

/** Exactly what the web dashboard page loads, before presentation. */
export interface RawDashboardData {
  kpi: {
    analyzedComments: number;
    riskComments: number;
    autoHidden: number;
    pending: number;
    accountsWithProblem: number;
  };
  deltas: { analyzedComments: number; riskComments: number; autoHidden: number };
  categories: { category: string; count: number }[];
  watched: WatchedAccountView[];
  /** Risk-comment timestamps in the window, already tenant-scoped. */
  trendDates: Date[];
  activity: { id: string; event: string; createdAt: Date }[];
  /** Aggregate protection, computed server-side from `accountProtectionScore`. */
  protection: { score: number; checks: { key: string; state: MobileCheckState }[] } | null;
  realTestMode: boolean;
}

/* -------------------------------------------------------------------------- */
/* Shared request gate                                                         */
/* -------------------------------------------------------------------------- */

const err = (status: number, error: MobileShellError): MobileShellResponse => ({ status, body: { error } });

/** Accepts only the exact `Bearer <token>` form; anything else fails closed. */
export function shellBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  return /^Bearer[ ]+(\S+)$/.exec(header.trim())?.[1] ?? null;
}

export type MobileGate =
  | { ok: true; session: ResolvedSession }
  | { ok: false; response: MobileShellResponse };

/**
 * The single authorization gate every authenticated mobile endpoint runs.
 *
 * Order mirrors the web dashboard layout exactly:
 *   1. a valid session (401)
 *   2. a VERIFIED email (403) — `requireVerifiedSession` on web
 *   3. a BUSINESS workspace (403) — web redirects a non-business kind away, and
 *      an unknown/corrupt kind FAILS CLOSED rather than reaching this dashboard
 *
 * The tenant is taken from the resolved session. Nothing the client sends is read.
 */
export async function authorizeBusinessRequest(
  authorization: string | null | undefined,
  deps: ShellSessionDeps,
): Promise<MobileGate> {
  const token = shellBearerToken(authorization);
  if (!token) return { ok: false, response: err(401, "unauthenticated") };

  const result = await deps.readUserSession(token);
  if (!result.ok || !result.session) {
    const reason = result.reason;
    if (reason === "session_expired_idle") deps.emitOpsEvent("auth.session_expired_idle", { reason });
    else if (reason === "session_expired_absolute") deps.emitOpsEvent("auth.session_expired_absolute", { reason });

    const mapped: MobileShellError =
      reason === "session_expired" || reason === "session_expired_idle" || reason === "session_expired_absolute"
        ? "session_expired"
        : reason === "session_revoked" || reason === "password_changed"
          ? "session_revoked"
          : "unauthenticated";
    return { ok: false, response: err(401, mapped) };
  }

  const session = result.session;
  // Password verification alone is not product access — the web gates on this too.
  if (!session.emailVerified) return { ok: false, response: err(403, "verification_required") };
  // Business-only. A family or unknown/corrupt kind never falls through.
  if (deps.classifyWorkspace(session.workspaceKind) !== "business") {
    return { ok: false, response: err(403, "workspace_unsupported") };
  }

  return { ok: true, session };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/bootstrap                                                   */
/* -------------------------------------------------------------------------- */

const DAY = 86_400_000;

/**
 * Trial days remaining, matching the web layout: whole days, never negative,
 * null when there is no trial end date.
 */
export function trialDaysLeft(trialEndsAt: Date | null | undefined, now: Date): number | null {
  if (!trialEndsAt) return null;
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY));
}

/**
 * Which banner the shell should show, mirroring the web `StateBanner` precedence:
 * restricted/suspended beats past-due, which beats a trial ending within 7 days.
 */
export function accessBannerFor(input: {
  accessState: string;
  billingStatus: string;
  trialDaysLeft: number | null;
}): MobileAccessBanner | null {
  if (input.accessState === "restricted" || input.accessState === "suspended") return "restricted";
  if (input.billingStatus === "past_due") return "past_due";
  if (
    input.billingStatus === "no_subscription" &&
    input.trialDaysLeft !== null &&
    input.trialDaysLeft > 0 &&
    input.trialDaysLeft <= 7
  ) {
    return "trial_ending";
  }
  return null;
}

/** Plan display name, matching the web layout's resolution order. */
export function planNameFor(billing: {
  billingStatus?: string | null;
  plan?: string | null;
  subscription?: { plan?: string | null } | null;
} | null): string | null {
  const key = billing?.subscription?.plan ?? (billing?.billingStatus === "no_subscription" ? null : billing?.plan) ?? null;
  if (!key) return null;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Translate the server-side denied-href set into the mobile destinations the user
 * may see. This is presentation only: hiding a tab never protects an endpoint.
 */
export function allowedNavFor(deniedHrefs: string[]): MobileNavKey[] {
  const denied = new Set(deniedHrefs);
  return MOBILE_NAV_KEYS.filter((key) => !denied.has(MOBILE_NAV_HREFS[key]));
}

export async function handleMobileBootstrap(
  req: { authorization: string | null | undefined },
  deps: BootstrapDeps,
): Promise<MobileShellResponse> {
  const gate = await authorizeBusinessRequest(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const session = gate.session;
  const now = deps.now?.() ?? new Date();

  let billing: Awaited<ReturnType<BootstrapDeps["getTenantBilling"]>>;
  let entitlements: Awaited<ReturnType<BootstrapDeps["getTenantEntitlements"]>>;
  let counters: Awaited<ReturnType<BootstrapDeps["getShellCounters"]>>;
  let unread: number;
  try {
    [billing, entitlements, counters, unread] = await Promise.all([
      deps.getTenantBilling(session.tenantId),
      deps.getTenantEntitlements(session.tenantId),
      deps.getShellCounters(session.tenantId),
      // Matching the web layout, an unread-count failure must not take the shell down.
      deps.unreadNotificationCount(session.tenantId, session.userId).catch(() => 0),
    ]);
  } catch {
    return err(500, "server_error");
  }

  const accessState = billing?.accessState ?? "full_access";
  const billingStatus = billing?.billingStatus ?? "no_subscription";
  const days = trialDaysLeft(billing?.trialEndsAt ?? null, now);

  const bootstrap: MobileBootstrap = {
    user: { name: session.userName, email: session.userEmail },
    workspace: {
      name: session.tenantName,
      kind: deps.classifyWorkspace(session.workspaceKind),
      demo: session.tenantName.toLowerCase().includes("demo"),
    },
    role: session.role,
    access: {
      state: accessState,
      billingStatus,
      trialDaysLeft: days,
      planName: planNameFor(billing),
      banner: accessBannerFor({ accessState, billingStatus, trialDaysLeft: days }),
      // Restricted/suspended is read-only — NOT signed out. The app hides write
      // affordances; the server still refuses the writes independently.
      canWrite: accessState !== "restricted" && accessState !== "suspended",
    },
    usage: {
      // Passed through as-is: `null` is a real answer (unlimited on this plan), and
      // substituting a number here would show the user a cap that does not exist.
      processedItems: {
        used: counters.processedItemsUsed,
        limit: entitlements.monthlyProcessedItems,
      },
      accounts: { used: counters.accountsUsed, limit: entitlements.maxConnectedAccounts },
    },
    counts: { pendingReview: counters.pendingReview, unreadNotifications: unread },
    nav: {
      allowed: allowedNavFor(
        deps.deniedNavHrefs({ role: session.role, workspaceKind: session.workspaceKind }),
      ),
    },
    generatedAt: now.toISOString(),
  };

  return { status: 200, body: { bootstrap: bootstrap as unknown as Record<string, unknown> } };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/dashboard                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Normalize the requested timeframe. Anything not in the allowed set — absent,
 * malformed, negative, fractional, or an injection attempt — becomes the default,
 * exactly as the web dashboard does with its `tf` search param.
 */
export function normalizeTimeframe(raw: string | number | null | undefined): MobileTimeframe {
  const n = typeof raw === "number" ? raw : Number(raw);
  return (MOBILE_TIMEFRAMES as readonly number[]).includes(n) ? (n as MobileTimeframe) : DEFAULT_TIMEFRAME;
}

/**
 * Percent change vs. the previous window. Returns null when the previous window is
 * zero — there is no honest baseline, and inventing "+100%" or "0%" would be a lie.
 * Identical to `deltaPct` in the web dashboard page.
 */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Map a watched account to its bounded status key, mirroring the web `accountBadge`. */
export function accountStatusFor(account: WatchedAccountView): MobileAccountStatus {
  switch (account.problem) {
    case "permissions_expired":
    case "needs_reconnect":
      return "permissions_expired";
    case "sync_failed":
      return "sync_failed";
    case "monitoring_off":
      return "monitoring_off";
    default:
      return account.status === "mock_connected" ? "demo" : "active";
  }
}

/** True only for the bounded activity set; anything else is dropped rather than rendered. */
export function isKnownActivityType(event: string): event is MobileActivityType {
  return (MOBILE_ACTIVITY_TYPES as readonly string[]).includes(event);
}

/**
 * Bucket risk-comment timestamps into the last `days` UTC days (inclusive of
 * today), producing a fixed-length series. Mirrors `bucketByDay` in the web app,
 * but emits only the day key + count — the app formats its own labels so the chart
 * respects the device locale.
 */
export function bucketByDay(dates: Date[], days: number, now: Date): MobileTrendBucket[] {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const index = new Map<string, number>();
  const buckets: MobileTrendBucket[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(todayUtc - i * DAY).toISOString().slice(0, 10);
    index.set(key, buckets.length);
    buckets.push({ key, count: 0 });
  }
  for (const date of dates) {
    const at = index.get(date.toISOString().slice(0, 10));
    if (at !== undefined) buckets[at]!.count += 1;
  }
  return buckets;
}

/** Dashboard slice size, matching the web `watched.slice(0, 6)`. */
export const WATCHED_ACCOUNTS_LIMIT = 6;
/** Recent-activity slice size, matching the web `take: 6`. */
export const ACTIVITY_LIMIT = 6;
/** Risk-category chips shown, matching the web `categories.slice(0, 6)`. */
export const CATEGORY_LIMIT = 6;

/**
 * Build the dashboard DTO from raw server data. Pure — every value is a projection
 * of something the server already computed. Nothing is recomputed on the client.
 */
export function buildDashboardDto(
  raw: RawDashboardData,
  timeframe: MobileTimeframe,
  now: Date,
): MobileDashboard {
  return {
    timeframe,
    generatedAt: now.toISOString(),
    // Same condition the web page uses to choose onboarding over a zeroed dashboard.
    isEmpty: raw.watched.length === 0 && raw.kpi.analyzedComments === 0,
    realTestMode: raw.realTestMode,
    overview: {
      analyzedComments: raw.kpi.analyzedComments,
      riskComments: raw.kpi.riskComments,
      autoHandled: raw.kpi.autoHidden,
      pendingReview: raw.kpi.pending,
      accountsWithProblem: raw.kpi.accountsWithProblem,
    },
    deltas: {
      analyzedComments: deltaPct(raw.kpi.analyzedComments, raw.deltas.analyzedComments),
      riskComments: deltaPct(raw.kpi.riskComments, raw.deltas.riskComments),
      autoHandled: deltaPct(raw.kpi.autoHidden, raw.deltas.autoHidden),
    },
    watchedAccounts: raw.watched.slice(0, WATCHED_ACCOUNTS_LIMIT).map((a) => ({
      id: a.id,
      platform: a.platform,
      name: a.externalName,
      status: accountStatusFor(a),
      comments: a.commentsInWindow,
      risky: a.riskCommentsInWindow,
      autoHideEnabled: a.protection.autoHideEnabled,
      monitoringEnabled: a.monitoringEnabled,
      lastSyncAt: a.lastSuccessfulSyncAt ? a.lastSuccessfulSyncAt.toISOString() : null,
    })),
    watchedAccountsTotal: raw.watched.length,
    protection: raw.protection,
    riskTrend: {
      buckets: bucketByDay(raw.trendDates, timeframe, now),
      total: raw.trendDates.length,
      categories: raw.categories.slice(0, CATEGORY_LIMIT),
    },
    // Unknown event names are DROPPED, never passed through as a raw string.
    recentActivity: raw.activity
      .filter((e) => isKnownActivityType(e.event))
      .slice(0, ACTIVITY_LIMIT)
      .map((e) => ({ id: e.id, type: e.event as MobileActivityType, at: e.createdAt.toISOString() })),
  };
}

export async function handleMobileDashboard(
  req: { authorization: string | null | undefined; timeframe: string | null | undefined },
  deps: DashboardDeps,
): Promise<MobileShellResponse> {
  const gate = await authorizeBusinessRequest(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const session = gate.session;
  const now = deps.now?.() ?? new Date();
  const timeframe = normalizeTimeframe(req.timeframe);
  const since = new Date(now.getTime() - timeframe * DAY);
  const prevSince = new Date(now.getTime() - 2 * timeframe * DAY);

  let raw: RawDashboardData;
  try {
    // The tenant comes from the validated session — never from the request.
    raw = await deps.loadDashboard({ tenantId: session.tenantId, since, prevSince });
  } catch {
    return err(500, "server_error");
  }

  return {
    status: 200,
    body: { dashboard: buildDashboardDto(raw, timeframe, now) as unknown as Record<string, unknown> },
  };
}
