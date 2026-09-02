/**
 * M3 — mobile bootstrap + Business dashboard API.
 *
 * PURE tests: the service takes every dependency by injection, so this runs with
 * fakes — no database, no Next, no network.
 *
 * The properties asserted are the ones that would be dangerous to get wrong:
 *   - the authorization gate (session → verified email → BUSINESS workspace) is
 *     re-run on EVERY endpoint and fails closed on an unknown workspace
 *   - nothing the client sends can influence the tenant, role or workspace
 *   - deltas never invent a baseline when the previous window is zero
 *   - unknown activity events are dropped, never rendered as a raw string
 *   - no secret, token, DB row or audit metadata reaches the response
 *
 * Run: pnpm mobile-shell:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { ResolvedSession, SessionRejectReason, WatchedAccountView } from "@guardora/db";
import {
  handleMobileBootstrap, handleMobileDashboard, authorizeBusinessRequest,
  shellBearerToken, normalizeTimeframe, deltaPct, accountStatusFor, isKnownActivityType,
  bucketByDay, buildDashboardDto, allowedNavFor, accessBannerFor, planNameFor, trialDaysLeft,
  MOBILE_NAV_HREFS, MOBILE_NAV_KEYS, WATCHED_ACCOUNTS_LIMIT, ACTIVITY_LIMIT,
  type BootstrapDeps, type DashboardDeps, type RawDashboardData, type MobileNavKey,
} from "../src/server/mobile-shell";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");
const dump = (o: unknown) => JSON.stringify(o);

const NOW = new Date("2026-06-15T12:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function session(over: Partial<ResolvedSession> = {}): ResolvedSession {
  return {
    sessionId: "sess_1", userId: "user_A", userName: "Ada Lovelace", userEmail: "ada@tamanor.test",
    emailVerified: true, tenantId: "tenant_A", tenantName: "Acme", workspaceKind: "business",
    role: "owner", expiresAt: new Date("2030-01-01"), absoluteExpiresAt: new Date("2030-01-01"),
    rememberMe: false, ...over,
  };
}

function account(over: Partial<WatchedAccountView> = {}): WatchedAccountView {
  return {
    id: "acc_1", platform: "facebook", externalName: "Acme Page", externalId: "ext_1",
    status: "active", health: "healthy", connectionStatus: "connected", tokenHealth: "ok",
    monitoringEnabled: true, lastSuccessfulSyncAt: new Date("2026-06-14T12:00:00.000Z"),
    connectionState: "CONNECTED_HEALTHY" as WatchedAccountView["connectionState"],
    autoSyncState: "ON" as WatchedAccountView["autoSyncState"],
    parentAccountId: null,
    // The full EffectiveProtection shape — no partial cast, so a change to the
    // real type surfaces here rather than being silently asserted away.
    protection: {
      monitoringEnabled: true,
      autoHideEnabled: true,
      autoHideMode: "automatic",
      autoHideRiskThreshold: "high",
      autoHideCategories: ["fraud"],
      requireManualApproval: false,
      source: "tenant_default",
    },
    commentsInWindow: 12, riskCommentsInWindow: 3, problem: "none",
    ...over,
  };
}

const classify = (kind: unknown) =>
  kind === "business" ? "business" as const : kind === "family" ? "family" as const : "unsupported" as const;

interface Rec { events: string[]; billingFor: string[]; countersFor: string[]; navFor: unknown[]; loadFor: unknown[] }

function bootstrapDeps(opts: {
  sessionResult?: { ok: boolean; session?: ResolvedSession; reason?: SessionRejectReason };
  billing?: Record<string, unknown> | null;
  entitlements?: { monthlyProcessedItems: number | null; maxConnectedAccounts: number | null };
  counters?: { processedItemsUsed: number; pendingReview: number; accountsUsed: number };
  unread?: number;
  denied?: string[];
  throws?: boolean;
  unreadThrows?: boolean;
} = {}): { deps: BootstrapDeps; rec: Rec } {
  const rec: Rec = { events: [], billingFor: [], countersFor: [], navFor: [], loadFor: [] };
  return {
    rec,
    deps: {
      readUserSession: async () => opts.sessionResult ?? { ok: true, session: session() },
      classifyWorkspace: classify,
      emitOpsEvent: (e) => rec.events.push(e),
      now: () => NOW,
      getTenantBilling: async (t) => {
        rec.billingFor.push(t);
        if (opts.throws) throw new Error("db down");
        return (opts.billing === undefined ? { accessState: "full_access", billingStatus: "active", plan: "growth" } : opts.billing) as never;
      },
      getTenantEntitlements: async () => opts.entitlements ?? { monthlyProcessedItems: 5000, maxConnectedAccounts: 10 },
      getShellCounters: async (t) => {
        rec.countersFor.push(t);
        return opts.counters ?? { processedItemsUsed: 120, pendingReview: 4, accountsUsed: 2 };
      },
      unreadNotificationCount: async () => {
        if (opts.unreadThrows) throw new Error("notifications down");
        return opts.unread ?? 7;
      },
      deniedNavHrefs: (o) => { rec.navFor.push(o); return opts.denied ?? []; },
    },
  };
}

function rawDashboard(over: Partial<RawDashboardData> = {}): RawDashboardData {
  return {
    kpi: { analyzedComments: 100, riskComments: 20, autoHidden: 8, pending: 4, accountsWithProblem: 1 },
    deltas: { analyzedComments: 80, riskComments: 25, autoHidden: 4 },
    categories: [{ category: "fraud", count: 9 }, { category: "spam", count: 5 }],
    watched: [account()],
    trendDates: [new Date("2026-06-14T09:00:00.000Z"), new Date("2026-06-15T09:00:00.000Z")],
    activity: [{ id: "a1", event: "sync.completed", createdAt: new Date("2026-06-15T10:00:00.000Z") }],
    protection: { score: 82, checks: [{ key: "syncHealthy", state: "ok" }] },
    realTestMode: false,
    ...over,
  };
}

function dashboardDeps(opts: {
  sessionResult?: { ok: boolean; session?: ResolvedSession; reason?: SessionRejectReason };
  raw?: RawDashboardData;
  throws?: boolean;
} = {}): { deps: DashboardDeps; rec: Rec } {
  const rec: Rec = { events: [], billingFor: [], countersFor: [], navFor: [], loadFor: [] };
  return {
    rec,
    deps: {
      readUserSession: async () => opts.sessionResult ?? { ok: true, session: session() },
      classifyWorkspace: classify,
      emitOpsEvent: (e) => rec.events.push(e),
      now: () => NOW,
      loadDashboard: async (input) => {
        rec.loadFor.push(input);
        if (opts.throws) throw new Error("db down");
        return opts.raw ?? rawDashboard();
      },
    },
  };
}

const auth = { authorization: "Bearer good-token" };

async function run() {
  /* ===================== AUTHORIZATION GATE ===================== */
  console.log("\nAUTHORIZATION GATE");

  for (const [label, header] of [
    ["missing header", null], ["empty", ""], ["bare token", "abc"],
    ["wrong scheme", "Basic abc"], ["Bearer with no token", "Bearer "], ["token with space", "Bearer a b"],
  ] as const) {
    const { deps } = bootstrapDeps();
    const res = await handleMobileBootstrap({ authorization: header }, deps);
    check(`bootstrap rejects ${label} → 401`, res.status === 401 && res.body.error === "unauthenticated");
    const { deps: d2 } = dashboardDeps();
    const res2 = await handleMobileDashboard({ authorization: header, timeframe: "30" }, d2);
    check(`dashboard rejects ${label} → 401`, res2.status === 401 && res2.body.error === "unauthenticated");
  }

  const rejectCases: Array<[SessionRejectReason, string]> = [
    ["session_revoked", "session_revoked"], ["password_changed", "session_revoked"],
    ["session_expired", "session_expired"], ["session_expired_idle", "session_expired"],
    ["session_expired_absolute", "session_expired"], ["membership_missing", "unauthenticated"],
    ["user_missing", "unauthenticated"], ["tenant_deleting", "unauthenticated"],
  ];
  for (const [reason, expected] of rejectCases) {
    const { deps } = bootstrapDeps({ sessionResult: { ok: false, reason } });
    const res = await handleMobileBootstrap(auth, deps);
    check(`${reason} → 401 ${expected}`, res.status === 401 && res.body.error === expected);
    check(`${reason} carries no bootstrap payload`, !("bootstrap" in res.body));
  }
  {
    const { deps, rec } = bootstrapDeps({ sessionResult: { ok: false, reason: "session_expired_idle" } });
    await handleMobileBootstrap(auth, deps);
    check("idle expiry is audited", rec.events.includes("auth.session_expired_idle"));
  }

  /* --------------------- verified email --------------------- */
  {
    const { deps, rec } = bootstrapDeps({ sessionResult: { ok: true, session: session({ emailVerified: false }) } });
    const res = await handleMobileBootstrap(auth, deps);
    check("unverified email → 403 verification_required", res.status === 403 && res.body.error === "verification_required");
    check("unverified email never reaches tenant data", rec.billingFor.length === 0);
  }
  {
    const { deps, rec } = dashboardDeps({ sessionResult: { ok: true, session: session({ emailVerified: false }) } });
    const res = await handleMobileDashboard({ ...auth, timeframe: "30" }, deps);
    check("dashboard also gates on verified email", res.status === 403 && res.body.error === "verification_required");
    check("unverified email never loads dashboard data", rec.loadFor.length === 0);
  }

  /* --------------------- workspace gate --------------------- */
  {
    const { deps, rec } = bootstrapDeps({ sessionResult: { ok: true, session: session({ workspaceKind: "family" }) } });
    const res = await handleMobileBootstrap(auth, deps);
    check("FAMILY does not receive Business bootstrap → 403", res.status === 403 && res.body.error === "workspace_unsupported");
    check("family never reaches tenant data", rec.billingFor.length === 0);
  }
  {
    const { deps, rec } = dashboardDeps({ sessionResult: { ok: true, session: session({ workspaceKind: "family" }) } });
    const res = await handleMobileDashboard({ ...auth, timeframe: "30" }, deps);
    check("FAMILY does not receive the Business dashboard → 403", res.status === 403 && res.body.error === "workspace_unsupported");
    check("family never loads dashboard data", rec.loadFor.length === 0);
  }
  for (const kind of ["", "internal", "child_safety_organization", "BUSINESS", "garbage", null, undefined, 42]) {
    const { deps } = dashboardDeps({ sessionResult: { ok: true, session: session({ workspaceKind: kind as string }) } });
    const res = await handleMobileDashboard({ ...auth, timeframe: "30" }, deps);
    check(`unknown workspace ${dump(kind)} FAILS CLOSED → 403`, res.status === 403 && res.body.error === "workspace_unsupported");
  }
  {
    const gate = await authorizeBusinessRequest("Bearer t", bootstrapDeps().deps);
    check("a business + verified session passes the gate", gate.ok === true);
  }

  /* ===================== BOOTSTRAP ===================== */
  console.log("\nBOOTSTRAP");

  {
    const { deps, rec } = bootstrapDeps();
    const res = await handleMobileBootstrap(auth, deps);
    const b = res.body.bootstrap as Record<string, never>;
    check("valid business session → 200", res.status === 200);
    check("identity comes from the session", (b.user as never as { email: string }).email === "ada@tamanor.test");
    check("workspace name comes from the session", (b.workspace as never as { name: string }).name === "Acme");
    check("role is reflected from the session", (b.role as unknown as string) === "owner");
    check("tenant is taken from the session for every lookup",
      rec.billingFor.every((t) => t === "tenant_A") && rec.countersFor.every((t) => t === "tenant_A"));
    check("nav gate is asked with the SESSION role + workspace",
      dump(rec.navFor[0]) === dump({ role: "owner", workspaceKind: "business" }));
  }
  {
    const { deps } = bootstrapDeps({ counters: { processedItemsUsed: 120, pendingReview: 9, accountsUsed: 3 }, unread: 5 });
    const res = await handleMobileBootstrap(auth, deps);
    const b = res.body.bootstrap as never as { counts: { pendingReview: number; unreadNotifications: number } };
    check("pending-review count is surfaced", b.counts.pendingReview === 9);
    check("unread-notification count is surfaced", b.counts.unreadNotifications === 5);
  }
  {
    const { deps } = bootstrapDeps({ unreadThrows: true });
    const res = await handleMobileBootstrap(auth, deps);
    const b = res.body.bootstrap as never as { counts: { unreadNotifications: number } };
    check("a notification-count failure degrades to 0, not a 500", res.status === 200 && b.counts.unreadNotifications === 0);
  }
  {
    const { deps } = bootstrapDeps({ throws: true });
    const res = await handleMobileBootstrap(auth, deps);
    check("a data failure → bounded 500", res.status === 500 && res.body.error === "server_error");
    check("the 500 leaks no internal detail", !dump(res).includes("db down"));
  }
  {
    const { deps } = bootstrapDeps({ entitlements: { monthlyProcessedItems: null, maxConnectedAccounts: null } });
    const res = await handleMobileBootstrap(auth, deps);
    const b = res.body.bootstrap as never as { usage: { processedItems: { limit: number | null } } };
    check("an unlimited plan cap is reported as null, not a fabricated number", b.usage.processedItems.limit === null);
  }
  {
    const { deps } = bootstrapDeps({ sessionResult: { ok: true, session: session({ tenantName: "Acme Demo Workspace" }) } });
    const res = await handleMobileBootstrap(auth, deps);
    check("a demo workspace is flagged", (res.body.bootstrap as never as { workspace: { demo: boolean } }).workspace.demo === true);
  }

  /* --------------------- access / billing state --------------------- */
  const bannerCases: Array<[Record<string, unknown> | null, string | null, boolean]> = [
    [{ accessState: "full_access", billingStatus: "active" }, null, true],
    [{ accessState: "restricted", billingStatus: "active" }, "restricted", false],
    [{ accessState: "suspended", billingStatus: "active" }, "restricted", false],
    [{ accessState: "full_access", billingStatus: "past_due" }, "past_due", true],
    [{ accessState: "full_access", billingStatus: "no_subscription", trialEndsAt: new Date("2026-06-19T12:00:00.000Z") }, "trial_ending", true],
    [{ accessState: "full_access", billingStatus: "no_subscription", trialEndsAt: new Date("2026-08-19T12:00:00.000Z") }, null, true],
    [null, null, true],
  ];
  for (const [billing, banner, canWrite] of bannerCases) {
    const { deps } = bootstrapDeps({ billing });
    const res = await handleMobileBootstrap(auth, deps);
    const a = (res.body.bootstrap as never as { access: { banner: string | null; canWrite: boolean } }).access;
    check(`billing ${dump(billing?.accessState ?? billing)} → banner ${dump(banner)}`, a.banner === banner);
    check(`billing ${dump(billing?.accessState ?? billing)} → canWrite ${canWrite}`, a.canWrite === canWrite);
  }
  check("restricted is NOT unauthenticated (still a 200 with data)",
    (await handleMobileBootstrap(auth, bootstrapDeps({ billing: { accessState: "restricted", billingStatus: "active" } }).deps)).status === 200);
  check("banner precedence: restricted beats past_due",
    accessBannerFor({ accessState: "restricted", billingStatus: "past_due", trialDaysLeft: 2 }) === "restricted");
  check("banner precedence: past_due beats trial", accessBannerFor({ accessState: "full_access", billingStatus: "past_due", trialDaysLeft: 2 }) === "past_due");
  check("a trial ending in 0 days is not a 'trial ending' banner", accessBannerFor({ accessState: "full_access", billingStatus: "no_subscription", trialDaysLeft: 0 }) === null);
  check("trialDaysLeft is never negative", trialDaysLeft(new Date("2026-01-01"), NOW) === 0);
  check("trialDaysLeft is null with no trial", trialDaysLeft(null, NOW) === null);
  check("plan name prefers the subscription plan", planNameFor({ billingStatus: "active", plan: "starter", subscription: { plan: "growth" } }) === "Growth");
  check("plan name is null on no_subscription", planNameFor({ billingStatus: "no_subscription", plan: "starter" }) === null);
  check("plan name is null when unknown", planNameFor(null) === null);

  /* --------------------- nav gating --------------------- */
  check("no denials → every mobile destination allowed", allowedNavFor([]).length === MOBILE_NAV_KEYS.length);
  {
    const allowed = allowedNavFor([MOBILE_NAV_HREFS.team, MOBILE_NAV_HREFS.billing]);
    check("a denied href removes exactly that destination", !allowed.includes("team") && !allowed.includes("billing"));
    check("...and leaves the others", allowed.includes("overview") && allowed.includes("accounts"));
  }
  {
    const allDenied = allowedNavFor(MOBILE_NAV_KEYS.map((k) => MOBILE_NAV_HREFS[k]));
    check("all denied → empty allowed set (fails closed)", allDenied.length === 0);
  }
  {
    const { deps } = bootstrapDeps({ denied: ["/dashboard/team"] });
    const res = await handleMobileBootstrap(auth, deps);
    const nav = (res.body.bootstrap as never as { nav: { allowed: MobileNavKey[] } }).nav;
    check("server-derived denial reaches the client as a reduced set", !nav.allowed.includes("team"));
  }

  /* ===================== DASHBOARD ===================== */
  console.log("\nDASHBOARD");

  for (const tf of [7, 30, 90]) {
    const { deps, rec } = dashboardDeps();
    const res = await handleMobileDashboard({ ...auth, timeframe: String(tf) }, deps);
    const d = res.body.dashboard as never as { timeframe: number; riskTrend: { buckets: unknown[] } };
    check(`timeframe ${tf} is honoured`, res.status === 200 && d.timeframe === tf);
    check(`timeframe ${tf} produces ${tf} buckets`, d.riskTrend.buckets.length === tf);
    const loaded = rec.loadFor[0] as { since: Date; prevSince: Date };
    const spanDays = Math.round((NOW.getTime() - loaded.since.getTime()) / 86_400_000);
    check(`timeframe ${tf} queries a ${tf}-day window`, spanDays === tf);
    check(`timeframe ${tf} previous window is the preceding ${tf} days`,
      Math.round((loaded.since.getTime() - loaded.prevSince.getTime()) / 86_400_000) === tf);
  }
  for (const bad of ["0", "-7", "1", "31", "abc", "", null, undefined, "7.5", "9999999", "30; DROP TABLE", "1e3"]) {
    check(`invalid timeframe ${dump(bad)} normalizes to 30`, normalizeTimeframe(bad) === 30);
  }
  check("a numeric timeframe is accepted", normalizeTimeframe(90) === 90);

  /* --------------------- KPIs + deltas --------------------- */
  {
    const dto = buildDashboardDto(rawDashboard(), 30, NOW);
    check("KPI mapping: analyzed", dto.overview.analyzedComments === 100);
    check("KPI mapping: risk", dto.overview.riskComments === 20);
    check("KPI mapping: autoHidden → autoHandled", dto.overview.autoHandled === 8);
    check("KPI mapping: pending → pendingReview", dto.overview.pendingReview === 4);
    check("KPI mapping: accountsWithProblem", dto.overview.accountsWithProblem === 1);
    check("delta is a percent vs. the previous window", dto.deltas.analyzedComments === 25);
    check("a negative delta is preserved", dto.deltas.riskComments === -20);
  }
  check("previous zero → NULL delta, never a fabricated percentage", deltaPct(50, 0) === null);
  check("previous negative → null", deltaPct(50, -1) === null);
  check("both zero → null (not 0%)", deltaPct(0, 0) === null);
  check("current zero with a real baseline → -100", deltaPct(0, 10) === -100);
  check("delta is rounded to one decimal", deltaPct(1, 3) === -66.7);
  {
    const dto = buildDashboardDto(rawDashboard({ deltas: { analyzedComments: 0, riskComments: 0, autoHidden: 0 } }), 30, NOW);
    check("a zero previous window yields null on every delta",
      dto.deltas.analyzedComments === null && dto.deltas.riskComments === null && dto.deltas.autoHandled === null);
  }

  /* --------------------- watched accounts --------------------- */
  const statusCases: Array<[Partial<WatchedAccountView>, string]> = [
    [{ problem: "permissions_expired" }, "permissions_expired"],
    [{ problem: "needs_reconnect" }, "permissions_expired"],
    [{ problem: "sync_failed" }, "sync_failed"],
    [{ problem: "monitoring_off" }, "monitoring_off"],
    [{ problem: "none", status: "mock_connected" }, "demo"],
    [{ problem: "none", status: "active" }, "active"],
  ];
  for (const [over, expected] of statusCases) {
    check(`account problem ${dump(over.problem)}/${dump(over.status ?? "active")} → ${expected}`,
      accountStatusFor(account(over)) === expected);
  }
  check("an ambiguous account is never optimistically 'active' when it has a problem",
    accountStatusFor(account({ problem: "sync_failed", status: "active" })) !== "active");
  {
    const many = Array.from({ length: 12 }, (_, i) => account({ id: `acc_${i}` }));
    const dto = buildDashboardDto(rawDashboard({ watched: many }), 30, NOW);
    check(`watched accounts are capped at ${WATCHED_ACCOUNTS_LIMIT}`, dto.watchedAccounts.length === WATCHED_ACCOUNTS_LIMIT);
    check("the true total is still reported", dto.watchedAccountsTotal === 12);
  }
  {
    const dto = buildDashboardDto(rawDashboard(), 30, NOW);
    const a = dto.watchedAccounts[0]!;
    check("account exposes only presentation fields",
      dump(Object.keys(a).sort()) === dump(["autoHideEnabled", "comments", "id", "lastSyncAt", "monitoringEnabled", "name", "platform", "risky", "status"]));
    check("lastSyncAt is an ISO string", a.lastSyncAt === "2026-06-14T12:00:00.000Z");
    check("a never-synced account reports null", buildDashboardDto(rawDashboard({ watched: [account({ lastSuccessfulSyncAt: null })] }), 30, NOW).watchedAccounts[0]!.lastSyncAt === null);
  }

  /* --------------------- protection --------------------- */
  {
    const dto = buildDashboardDto(rawDashboard(), 30, NOW);
    check("protection is passed through from the server aggregation", dto.protection?.score === 82);
    check("protection checks carry a KEY and a state, never prose",
      dump(dto.protection?.checks) === dump([{ key: "syncHealthy", state: "ok" }]));
  }
  check("no monitored account → protection is null (card hidden, not faked)",
    buildDashboardDto(rawDashboard({ protection: null }), 30, NOW).protection === null);

  /* --------------------- risk trend --------------------- */
  {
    const dto = buildDashboardDto(rawDashboard(), 7, NOW);
    check("trend has one bucket per day", dto.riskTrend.buckets.length === 7);
    check("the last bucket is today (UTC)", dto.riskTrend.buckets[6]!.key === "2026-06-15");
    check("counts land in the right day", dto.riskTrend.buckets[6]!.count === 1 && dto.riskTrend.buckets[5]!.count === 1);
    check("the total is the raw count", dto.riskTrend.total === 2);
    check("buckets carry no server-formatted label (the app localizes)",
      dump(Object.keys(dto.riskTrend.buckets[0]!).sort()) === dump(["count", "key"]));
  }
  {
    const dto = buildDashboardDto(rawDashboard({ trendDates: [] }), 30, NOW);
    check("an empty trend still returns a full-length series", dto.riskTrend.buckets.length === 30);
    check("...with zero total", dto.riskTrend.total === 0);
  }
  {
    // A date outside the window must not be silently folded into a bucket.
    const outside = bucketByDay([new Date("2020-01-01T00:00:00.000Z")], 7, NOW);
    check("an out-of-window date is ignored", outside.every((b) => b.count === 0));
  }
  {
    const many = Array.from({ length: 20 }, (_, i) => ({ category: `c${i}`, count: i }));
    check("risk categories are capped at 6", buildDashboardDto(rawDashboard({ categories: many }), 30, NOW).riskTrend.categories.length === 6);
  }

  /* --------------------- recent activity --------------------- */
  {
    const events = [
      "sync.completed", "sync.failed", "auto_protect.would_auto_hide", "protection.action_executed",
      "incident.created", "proposal.created", "account.connected", "token.expired",
    ];
    for (const e of events) check(`activity type ${e} is recognised`, isKnownActivityType(e));
  }
  for (const e of ["user.deleted", "billing.charge", "", "SYNC.COMPLETED", "sync.completed ", "__proto__"]) {
    check(`unknown activity ${dump(e)} is NOT recognised`, !isKnownActivityType(e));
  }
  {
    const dto = buildDashboardDto(rawDashboard({
      activity: [
        { id: "a1", event: "sync.completed", createdAt: NOW },
        { id: "a2", event: "internal.secret_event", createdAt: NOW },
        { id: "a3", event: "token.expired", createdAt: NOW },
      ],
    }), 30, NOW);
    check("unknown activity events are DROPPED", dto.recentActivity.length === 2);
    check("...and never appear as a raw string", !dump(dto).includes("internal.secret_event"));
    check("known events keep their bounded type", dto.recentActivity.map((a) => a.type).join(",") === "sync.completed,token.expired");
    check("activity rows carry only id/type/at",
      dump(Object.keys(dto.recentActivity[0]!).sort()) === dump(["at", "id", "type"]));
  }
  {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, event: "sync.completed", createdAt: NOW }));
    check(`recent activity is bounded to ${ACTIVITY_LIMIT}`, buildDashboardDto(rawDashboard({ activity: many }), 30, NOW).recentActivity.length === ACTIVITY_LIMIT);
  }

  /* --------------------- empty workspace --------------------- */
  {
    const empty = buildDashboardDto(rawDashboard({
      watched: [], kpi: { analyzedComments: 0, riskComments: 0, autoHidden: 0, pending: 0, accountsWithProblem: 0 },
    }), 30, NOW);
    check("no accounts + no comments → isEmpty (onboarding, not a zeroed dashboard)", empty.isEmpty === true);
  }
  check("accounts but no comments is NOT empty",
    buildDashboardDto(rawDashboard({ kpi: { analyzedComments: 0, riskComments: 0, autoHidden: 0, pending: 0, accountsWithProblem: 0 } }), 30, NOW).isEmpty === false);
  check("comments but no accounts is NOT empty",
    buildDashboardDto(rawDashboard({ watched: [] }), 30, NOW).isEmpty === false);
  check("real test mode is surfaced",
    buildDashboardDto(rawDashboard({ realTestMode: true }), 30, NOW).realTestMode === true);

  /* ===================== SECURITY ===================== */
  console.log("\nSECURITY");

  {
    // Nothing in the request may influence identity: the handlers accept only an
    // Authorization header and a timeframe, so there is no field to smuggle.
    const { deps, rec } = dashboardDeps();
    await handleMobileDashboard({ ...auth, timeframe: "30" }, deps);
    check("dashboard is loaded for the SESSION tenant only",
      (rec.loadFor[0] as { tenantId: string }).tenantId === "tenant_A");
  }
  {
    const { deps, rec } = dashboardDeps({ sessionResult: { ok: true, session: session({ tenantId: "tenant_B", tenantName: "Beta" }) } });
    await handleMobileDashboard({ ...auth, timeframe: "30" }, deps);
    check("a token for tenant B loads tenant B — never A",
      (rec.loadFor[0] as { tenantId: string }).tenantId === "tenant_B");
  }
  {
    // The handler signatures physically cannot accept these, which is the point.
    const handlerSrc = readSrc("apps/web/src/server/mobile-shell.ts");
    check("the request type has no tenantId field", !/authorization[\s\S]{0,400}tenantId\??:/.test(handlerSrc));
    check("tenant is only ever read from the session", !handlerSrc.includes("req.tenantId") && !handlerSrc.includes("body.tenantId"));
    check("role is only ever read from the session", !handlerSrc.includes("req.role"));
    check("workspace kind is only ever read from the session", !handlerSrc.includes("req.workspaceKind"));
  }
  {
    const { deps } = bootstrapDeps();
    const res = await handleMobileBootstrap(auth, deps);
    const s = dump(res.body);
    check("bootstrap exposes no session token", !s.includes("token"));
    check("bootstrap exposes no user/tenant/session id", !s.includes("user_A") && !s.includes("tenant_A") && !s.includes("sess_1"));
    check("bootstrap exposes no password hash", !s.includes("argon2") && !s.includes("passwordHash"));
    check("bootstrap top level is only { bootstrap }", dump(Object.keys(res.body)) === dump(["bootstrap"]));
  }
  {
    const { deps } = dashboardDeps();
    const res = await handleMobileDashboard({ ...auth, timeframe: "30" }, deps);
    const s = dump(res.body);
    check("dashboard exposes no session token", !s.includes("Bearer") && !s.includes("good-token"));
    check("dashboard exposes no tenant id", !s.includes("tenant_A"));
    check("dashboard exposes no audit metadata", !s.includes("metadata") && !s.includes("actorId") && !s.includes("ipAddress"));
    check("dashboard top level is only { dashboard }", dump(Object.keys(res.body)) === dump(["dashboard"]));
    check("dashboard exposes no raw connection internals",
      !s.includes("connectionState") && !s.includes("tokenHealth") && !s.includes("externalId"));
  }
  {
    const { deps } = dashboardDeps({ throws: true });
    const res = await handleMobileDashboard({ ...auth, timeframe: "30" }, deps);
    check("a dashboard data failure → bounded 500", res.status === 500 && res.body.error === "server_error");
    check("...leaking no internal detail", !dump(res).includes("db down"));
  }

  /* ===================== SOURCE PARITY ===================== */
  console.log("\nSOURCE PARITY");

  {
    const deps = readSrc("apps/web/src/server/mobile-shell-deps.ts");
    const bootRoute = readSrc("apps/web/src/app/api/mobile/bootstrap/route.ts");
    const dashRoute = readSrc("apps/web/src/app/api/mobile/dashboard/route.ts");

    check("mobile reuses the web dashboard KPI functions",
      ["getDashboardKpis", "getDashboardKpiDeltas", "getRiskByCategory", "getWatchedAccountsView"].every((f) => deps.includes(f)));
    check("mobile reuses the server protection score", deps.includes("accountProtectionScore"));
    check("mobile reuses the server nav gate", deps.includes("computeDeniedNavHrefs"));
    check("mobile reuses the server billing + entitlements", deps.includes("getTenantBilling") && deps.includes("getTenantEntitlements"));
    check("mobile reuses the data-mode filter", deps.includes("getRealModeFilter"));
    check("activity is bounded at the QUERY, not just in the mapper", deps.includes("event: { in: [...MOBILE_ACTIVITY_TYPES] }"));
    check("mobile does not re-implement a protection formula", !deps.includes("computeProtectionScore("));
    check("routes set no cookie", !bootRoute.includes("cookies") && !dashRoute.includes("cookies"));
    check("routes are no-store", bootRoute.includes("no-store") && dashRoute.includes("no-store"));
    check("dashboard route reads ONLY timeframe from the query", (dashRoute.match(/searchParams\.get\(/g) ?? []).length === 1);
    check("the service module holds no Prisma access", !readSrc("apps/web/src/server/mobile-shell.ts").includes("prisma"));
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — mobile shell + dashboard API (M3): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
