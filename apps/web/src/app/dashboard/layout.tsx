import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireVerifiedSession } from "@/server/auth";
import { withTenant, getTenantBilling, getTenantEntitlements } from "@guardora/db";
import { getLocale } from "@/i18n/locale-server";
import { getDictionary, type Locale } from "@/i18n";

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
  const session = await requireVerifiedSession();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const now = new Date();
  const [tenant, period, billing, ent] = await Promise.all([
    withTenant(session.tenantId, (db) => db.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true } })),
    // V1.50E — authoritative PERIOD-scoped processed-item usage (current billing month), not an
    // all-time count. Avoids impossible values like "5038 / 500" on a fresh trial.
    withTenant(session.tenantId, (db) => db.usagePeriod.findFirst({
      where: { tenantId: session.tenantId, periodStart: { lte: now }, periodEnd: { gt: now } },
      select: { basicUnitsUsed: true },
    })),
    getTenantBilling(session.tenantId),
    getTenantEntitlements(session.tenantId),
  ]);

  const isDemoWorkspace = (tenant?.name ?? "").toLowerCase().includes("demo");
  const trialDaysLeft = billing?.trialEndsAt ? Math.max(0, Math.ceil((billing.trialEndsAt.getTime() - Date.now()) / DAY)) : null;

  return (
    <DashboardShell
      tenantName={tenant?.name ?? session.tenantName}
      userName={session.userName}
      role={session.role}
      trialUsed={period?.basicUnitsUsed ?? 0}
      trialLimit={ent.monthlyProcessedItems || 500}
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
