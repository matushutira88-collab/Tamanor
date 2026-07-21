import Link from "next/link";
import { cookies } from "next/headers";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireVerifiedSession } from "@/server/auth";
import { withTenant, getTenantBilling, getTenantEntitlements, unreadNotificationCount } from "@guardora/db";
import { getLocale } from "@/i18n/locale-server";
import { getDictionary, type Locale } from "@/i18n";
import { TRACE_COOKIE, readValidTraceId, newTraceId, logPhase, withPhase } from "@/server/diagnostics/login-trace";

const DAY = 24 * 60 * 60 * 1000;

// V1.50E — truthful account-state banner shown across the dashboard. Billing + deletion always
// stay reachable; the banner explains restricted/past-due/trial state and links to billing.
function StateBanner({ accessState, billingStatus, trialDaysLeft, locale }: { accessState: string; billingStatus: string; trialDaysLeft: number | null; locale: Locale }) {
  const T = {
    en: { restricted: "Your trial or subscription has ended — you're in read-only restricted mode. Choose a plan to restore full access.", pastDue: "Your last payment failed. Update your payment method to keep full access.", trial: (n: number) => `Free trial — ${n} ${n === 1 ? "day" : "days"} left.`, cta: "Go to billing" },
    sk: { restricted: "Vaša skúšobná verzia alebo predplatné skončilo — ste v obmedzenom režime iba na čítanie. Vyberte plán a obnovte plný prístup.", pastDue: "Posledná platba zlyhala. Aktualizujte platobnú metódu, aby ste si zachovali plný prístup.", trial: (n: number) => `Skúšobná verzia — zostáva ${n} dní.`, cta: "Prejsť na fakturáciu" },
    de: { restricted: "Ihre Testphase oder Ihr Abo ist beendet — Sie sind im eingeschränkten Nur-Lese-Modus. Wählen Sie einen Tarif für vollen Zugriff.", pastDue: "Ihre letzte Zahlung ist fehlgeschlagen. Aktualisieren Sie Ihre Zahlungsmethode.", trial: (n: number) => `Testphase — noch ${n} Tage.`, cta: "Zur Abrechnung" },
  }[locale];
  const restricted = accessState === "restricted" || accessState === "suspended";
  const pastDue = billingStatus === "past_due";
  const trialWarn = billingStatus === "no_subscription" && trialDaysLeft !== null && trialDaysLeft <= 7 && trialDaysLeft > 0;
  if (!restricted && !pastDue && !trialWarn) return null;
  const tone = restricted ? "danger" : pastDue ? "warn" : "brand";
  const msg = restricted ? T.restricted : pastDue ? T.pastDue : T.trial(trialDaysLeft ?? 0);
  return (
    <div role="status" className={`flex flex-col items-start gap-2 border-b px-6 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between border-[var(--color-${tone})] bg-[var(--color-${tone}-soft)]`}>
      <span className={`text-[var(--color-${tone})]`}>{msg}</span>
      <Link href="/dashboard/billing" className="shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs font-semibold">{T.cta}</Link>
    </div>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // V1.63 — first-authenticated-render trace. Prefer the login traceId inherited from the httpOnly cookie
  // (a Server Component can READ but not write it). When the cookie is absent — direct /dashboard open,
  // refresh after the trace expired, or an existing session with no fresh login — we mint a LOCAL dashboard
  // trace. V1.63.1: that fallback is tagged `traceSource:"fallback"` so it is NEVER read as proof that a
  // specific login flow continued; it just keeps the render self-correlated.
  const cookieTraceId = readValidTraceId((await cookies()).get(TRACE_COOKIE)?.value);
  const traceId = cookieTraceId ?? newTraceId();
  const traceSource = cookieTraceId ? "cookie" : "fallback";
  logPhase({ traceId, traceSource, phase: "DASHBOARD_BOOTSTRAP_STARTED", route: "/dashboard", success: true });

  const session = await withPhase(traceId, "SESSION_READ", () => requireVerifiedSession(), { route: "/dashboard" });
  logPhase({ traceId, phase: "USER_CONTEXT_RESOLVED", success: true, userId: session.userId, tenantId: session.tenantId });
  logPhase({ traceId, phase: "TENANT_LOADED", success: true, tenantId: session.tenantId });
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const now = new Date();
  // V1.51 perf — the tenant NAME already rides the validated session (`session.tenantName`), so the
  // former per-render `tenant.findUnique(name)` withTenant transaction was a redundant round trip.
  // Dropped: one fewer tenant transaction (set_config + query) on every dashboard navigation.
  const [[period, pendingCount, accountsUsed], billing, ent] = await Promise.all([
    // V1.50E — authoritative PERIOD-scoped processed-item usage (current billing month), not an
    // all-time count. Avoids impossible values like "5038 / 500" on a fresh trial.
    // V1.60 — plus the two small sidebar counts (alerts badge, plan-widget accounts) in the
    // same tenant transaction so navigation stays a single withTenant round trip.
    withPhase(traceId, "USAGE_LOADED", () => withTenant(session.tenantId, (db) => Promise.all([
      db.usagePeriod.findFirst({
        where: { tenantId: session.tenantId, periodStart: { lte: now }, periodEnd: { gt: now } },
        select: { basicUnitsUsed: true },
      }),
      // V1.60 — sidebar "Alerts" badge: same source as the dashboard "pending" KPI
      // (action-queue items awaiting approval), so the two never disagree.
      db.actionQueueItem.count({ where: { tenantId: session.tenantId, queueState: "approval_required" } }),
      db.connectedAccount.count({ where: { tenantId: session.tenantId, status: { in: ["active", "mock_connected"] } } }),
    ])), { userId: session.userId, tenantId: session.tenantId }),
    withPhase(traceId, "BILLING_LOADED", () => getTenantBilling(session.tenantId), { tenantId: session.tenantId }),
    withPhase(traceId, "ENTITLEMENTS_LOADED", () => getTenantEntitlements(session.tenantId), { tenantId: session.tenantId }),
  ]);

  const isDemoWorkspace = session.tenantName.toLowerCase().includes("demo");
  const trialDaysLeft = billing?.trialEndsAt ? Math.max(0, Math.ceil((billing.trialEndsAt.getTime() - Date.now()) / DAY)) : null;
  // V1.60 — plan-widget display name: paid subscription plan wins; trial shows the localized fallback.
  const planKey = billing?.subscription?.plan ?? (billing?.billingStatus === "no_subscription" ? null : billing?.plan) ?? null;
  const planName = planKey ? planKey.charAt(0).toUpperCase() + planKey.slice(1) : undefined;

  logPhase({ traceId, phase: "SHELL_RENDER_STARTED", success: true, userId: session.userId, tenantId: session.tenantId });
  // Server data bootstrap is done; the client mount marker (DASHBOARD_CLIENT_MOUNTED) confirms hydration.
  logPhase({ traceId, phase: "DASHBOARD_BOOTSTRAP_COMPLETED", success: true, userId: session.userId, tenantId: session.tenantId });

  return (
    <DashboardShell
      traceId={traceId}
      tenantName={session.tenantName}
      userName={session.userName}
      role={session.role}
      trialUsed={period?.basicUnitsUsed ?? 0}
      trialLimit={ent.monthlyProcessedItems || 500}
      planName={planName}
      accountsUsed={accountsUsed}
      accountsLimit={ent.maxConnectedAccounts}
      pendingCount={pendingCount}
      unreadNotifications={await unreadNotificationCount(session.tenantId, session.userId).catch(() => 0)}
      demo={isDemoWorkspace}
      locale={locale}
      navLabels={dict.dashboardNav}
      sidebarStrings={dict.sidebar}
    >
      <StateBanner accessState={billing?.accessState ?? "full_access"} billingStatus={billing?.billingStatus ?? "no_subscription"} trialDaysLeft={trialDaysLeft} locale={locale} />
      {children}
    </DashboardShell>
  );
}
