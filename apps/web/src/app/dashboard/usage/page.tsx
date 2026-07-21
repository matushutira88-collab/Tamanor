import Link from "next/link";
import { requireSession } from "@/server/auth";
import { withTenant, getUsageSummary, getUsageDiagnostic, getTenantResourceUsage, getTenantBilling, getTenantEntitlements, type UsageStatus } from "@guardora/db";
import { type TenantLifecycleState } from "@guardora/core";
import { getPaidAiFuseConfig } from "@guardora/config";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<UsageStatus, "ok" | "warn" | "danger"> = { normal: "ok", warning: "warn", critical: "warn", exhausted: "danger" };

const COPY: Record<Locale, {
  eyebrow: string;
  title: string;
  description: string;
  statusLabel: Record<UsageStatus, string>;
  planWord: string;
  resets: string;
  meterBasic: string;
  meterCalls: string;
  meterBudget: string;
  usageCopy: string;
  paidStatus: (on: boolean) => string;
  resourcesTitle: string;
  meterConnections: string;
  meterBrands: string;
  overLimit: string;
  paymentIssue: string;
  manageBilling: string;
  planBillingTitle: string;
  lifecycleLabel: Record<TenantLifecycleState, string>;
  trialDaysLeft: (n: number) => string;
  trialEndsToday: string;
  nextPayment: string;
  cancelsOn: string;
  firstSyncPending: (n: number) => string;
  monitoringDisabledByPlan: (n: number) => string;
  diagnosticTitle: string;
  adminOnly: string;
  dEffectivePlan: string;
  dPaidFallback: string;
  dGeneratedReplies: string;
  dOpenReservations: string;
  dStaleReservations: string;
  dDenied: string;
  dCacheHitRate: string;
  dPaidEnabled: string;
  dGlobalCalls: string;
  dGlobalCost: string;
  dMaxConcurrency: string;
  dRpm: string;
}> = {
  en: {
    eyebrow: "Plan",
    title: "Usage",
    description: "Your monthly AI usage and limits. Your inbox always remains available.",
    statusLabel: { normal: "Normal", warning: "Warning", critical: "Critical", exhausted: "Exhausted" },
    planWord: "plan",
    resets: "resets",
    meterBasic: "Basic AI checks",
    meterCalls: "Advanced AI analyses",
    meterBudget: "Advanced AI budget",
    usageCopy: "Advanced AI pauses when the monthly limit is reached. Your inbox remains available.",
    paidStatus: (on) => `Advanced (paid) AI is ${on ? "enabled" : "disabled"}.`,
    resourcesTitle: "Plan resources",
    meterConnections: "Connected accounts",
    meterBrands: "Brands",
    overLimit: "You're over your plan limit — no new items can be added until you upgrade or remove some. Existing data stays intact.",
    paymentIssue: "There's a problem with your billing. Restore full access to keep syncing and taking action.",
    manageBilling: "Manage billing",
    planBillingTitle: "Plan & billing",
    lifecycleLabel: { active_trial: "Trial", trial_expired: "Trial expired", active_paid: "Active", past_due: "Payment due", canceled: "Canceled", suspended: "Suspended" },
    trialDaysLeft: (n) => `${n} day${n === 1 ? "" : "s"} left in your trial`,
    trialEndsToday: "Your trial ends today",
    nextPayment: "Next payment",
    cancelsOn: "Cancels on",
    firstSyncPending: (n) => `First sync pending for ${n} account${n === 1 ? "" : "s"} — results appear after the first read-only sync.`,
    monitoringDisabledByPlan: (n) => `${n} account${n === 1 ? "" : "s"} ${n === 1 ? "has" : "have"} monitoring disabled by your plan limit. Upgrade to re-enable.`,
    diagnosticTitle: "Diagnostic",
    adminOnly: "· admin only",
    dEffectivePlan: "Effective plan",
    dPaidFallback: "Paid fallback allowed",
    dGeneratedReplies: "Generated replies",
    dOpenReservations: "Open reservations",
    dStaleReservations: "Stale reservations",
    dDenied: "Denied (period)",
    dCacheHitRate: "Cache hit rate",
    dPaidEnabled: "Paid AI enabled",
    dGlobalCalls: "Global daily calls cap",
    dGlobalCost: "Global daily cost cap",
    dMaxConcurrency: "Max concurrency",
    dRpm: "RPM limit",
  },
  sk: {
    eyebrow: "Plán",
    title: "Spotreba",
    description: "Vaša mesačná spotreba AI a limity. Vaša schránka zostáva vždy dostupná.",
    statusLabel: { normal: "Normálny", warning: "Upozornenie", critical: "Kritický", exhausted: "Vyčerpaný" },
    planWord: "plán",
    resets: "obnovuje sa",
    meterBasic: "Základné kontroly AI",
    meterCalls: "Pokročilé analýzy AI",
    meterBudget: "Rozpočet na pokročilú AI",
    usageCopy: "Pokročilá AI sa pozastaví po dosiahnutí mesačného limitu. Vaša schránka zostáva dostupná.",
    paidStatus: (on) => `Pokročilá (platená) AI je ${on ? "zapnutá" : "vypnutá"}.`,
    resourcesTitle: "Zdroje plánu",
    meterConnections: "Pripojené účty",
    meterBrands: "Značky",
    overLimit: "Prekročili ste limit plánu — kým neprejdete na vyšší plán alebo niečo neodstránite, nedajú sa pridať nové položky. Existujúce dáta zostávajú nedotknuté.",
    paymentIssue: "S vašou fakturáciou je problém. Obnovte plný prístup, aby synchronizácia a akcie pokračovali.",
    manageBilling: "Spravovať fakturáciu",
    planBillingTitle: "Plán a fakturácia",
    lifecycleLabel: { active_trial: "Skúšobné", trial_expired: "Skúšobné vypršalo", active_paid: "Aktívny", past_due: "Čaká sa platba", canceled: "Zrušený", suspended: "Pozastavený" },
    trialDaysLeft: (n) => `${n} ${n === 1 ? "deň" : n >= 2 && n <= 4 ? "dni" : "dní"} do konca skúšobnej verzie`,
    trialEndsToday: "Vaša skúšobná verzia končí dnes",
    nextPayment: "Ďalšia platba",
    cancelsOn: "Ruší sa dňa",
    firstSyncPending: (n) => `Prvá synchronizácia čaká pre ${n} ${n === 1 ? "účet" : n >= 2 && n <= 4 ? "účty" : "účtov"} — výsledky sa zobrazia po prvej read-only synchronizácii.`,
    monitoringDisabledByPlan: (n) => `${n} ${n === 1 ? "účet má" : n >= 2 && n <= 4 ? "účty majú" : "účtov má"} vypnutý monitoring kvôli limitu plánu. Prejdite na vyšší plán pre opätovné zapnutie.`,
    diagnosticTitle: "Diagnostika",
    adminOnly: "· len pre správcu",
    dEffectivePlan: "Efektívny plán",
    dPaidFallback: "Povolený platený fallback",
    dGeneratedReplies: "Generované odpovede",
    dOpenReservations: "Otvorené rezervácie",
    dStaleReservations: "Neaktuálne rezervácie",
    dDenied: "Zamietnuté (obdobie)",
    dCacheHitRate: "Miera zásahov cache",
    dPaidEnabled: "Platená AI zapnutá",
    dGlobalCalls: "Globálny denný limit volaní",
    dGlobalCost: "Globálny denný limit nákladov",
    dMaxConcurrency: "Max. súbežnosť",
    dRpm: "Limit RPM",
  },
  de: {
    eyebrow: "Tarif",
    title: "Nutzung",
    description: "Ihre monatliche KI-Nutzung und Limits. Ihr Postfach bleibt jederzeit verfügbar.",
    statusLabel: { normal: "Normal", warning: "Warnung", critical: "Kritisch", exhausted: "Erschöpft" },
    planWord: "Tarif",
    resets: "zurückgesetzt am",
    meterBasic: "Einfache KI-Prüfungen",
    meterCalls: "Erweiterte KI-Analysen",
    meterBudget: "Budget für erweiterte KI",
    usageCopy: "Die erweiterte KI pausiert, sobald das monatliche Limit erreicht ist. Ihr Postfach bleibt verfügbar.",
    paidStatus: (on) => `Die erweiterte (kostenpflichtige) KI ist ${on ? "aktiviert" : "deaktiviert"}.`,
    resourcesTitle: "Tarif-Ressourcen",
    meterConnections: "Verbundene Konten",
    meterBrands: "Marken",
    overLimit: "Sie haben Ihr Tariflimit überschritten — bis zu einem Upgrade oder Entfernen können keine neuen Einträge hinzugefügt werden. Vorhandene Daten bleiben erhalten.",
    paymentIssue: "Mit Ihrer Abrechnung stimmt etwas nicht. Stellen Sie den vollen Zugriff wieder her, damit Synchronisierung und Aktionen weiterlaufen.",
    manageBilling: "Abrechnung verwalten",
    planBillingTitle: "Tarif & Abrechnung",
    lifecycleLabel: { active_trial: "Testphase", trial_expired: "Testphase abgelaufen", active_paid: "Aktiv", past_due: "Zahlung fällig", canceled: "Gekündigt", suspended: "Gesperrt" },
    trialDaysLeft: (n) => `Noch ${n} Tag${n === 1 ? "" : "e"} in Ihrer Testphase`,
    trialEndsToday: "Ihre Testphase endet heute",
    nextPayment: "Nächste Zahlung",
    cancelsOn: "Kündigung zum",
    firstSyncPending: (n) => `Erste Synchronisierung ausstehend für ${n} Konto${n === 1 ? "" : "s"} — Ergebnisse erscheinen nach der ersten schreibgeschützten Synchronisierung.`,
    monitoringDisabledByPlan: (n) => `Bei ${n} Konto${n === 1 ? "" : "s"} ist das Monitoring durch Ihr Tariflimit deaktiviert. Upgraden Sie, um es wieder zu aktivieren.`,
    diagnosticTitle: "Diagnose",
    adminOnly: "· nur für Administratoren",
    dEffectivePlan: "Effektiver Tarif",
    dPaidFallback: "Kostenpflichtiger Fallback erlaubt",
    dGeneratedReplies: "Generierte Antworten",
    dOpenReservations: "Offene Reservierungen",
    dStaleReservations: "Veraltete Reservierungen",
    dDenied: "Abgelehnt (Zeitraum)",
    dCacheHitRate: "Cache-Trefferquote",
    dPaidEnabled: "Kostenpflichtige KI aktiviert",
    dGlobalCalls: "Globales tägliches Aufruflimit",
    dGlobalCost: "Globales tägliches Kostenlimit",
    dMaxConcurrency: "Max. Nebenläufigkeit",
    dRpm: "RPM-Limit",
  },
};

const euros = (micros: bigint) => `€${(Number(micros) / 1_000_000).toFixed(2)}`;
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

function Meter({ label, used, limit, percent, testid, suffix }: { label: string; used: string; limit: string; percent: number; testid: string; suffix?: string }) {
  const tone = percent >= 100 ? "var(--color-danger)" : percent >= 80 ? "var(--color-warn)" : "var(--color-brand)";
  return (
    <div data-testid={testid} data-percent={percent}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-[var(--color-muted)]">{used} / {limit}{suffix ?? ""}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, percent)}%`, background: tone }} />
      </div>
    </div>
  );
}

export default async function UsagePage() {
  const session = await requireSession();
  const tenant = await withTenant(session.tenantId, (db) => db.tenant.findUnique({ where: { id: session.tenantId }, select: { plan: true, internalAccess: true } }));
  const plan = tenant?.plan ?? "free";
  const internalAccess = tenant?.internalAccess ?? false;
  // V1.73 — internal admin tenant displays as unlimited (matching enforcement).
  const summary = await getUsageSummary(session.tenantId, plan, new Date(), internalAccess);
  const fuse = getPaidAiFuseConfig();
  const isAdmin = session.role === "owner" || session.role === "admin";
  const diag = isAdmin ? await getUsageDiagnostic(session.tenantId, plan) : null;
  const locale = await getLocale();
  const c = COPY[locale];

  // Canonical resource usage — the SAME counting helpers + effective (internal-aware) entitlements the
  // server enforces at create time. getTenantEntitlements reflects unlimited for an internal admin tenant.
  const resources = await getTenantResourceUsage(session.tenantId);
  const planLimits = await getTenantEntitlements(session.tenantId);
  const billing = await getTenantBilling(session.tenantId);
  // V1.68 (Release A / A6) — first-sync-pending + monitoring-disabled-by-plan visibility. Both are
  // counted from the SAME account model the sync/enforcement paths use (non-disconnected accounts).
  const accountStates = await withTenant(session.tenantId, async (db) => {
    const [firstSyncPending, monitoringDisabled] = await Promise.all([
      db.connectedAccount.count({ where: { tenantId: session.tenantId, status: { not: "disconnected" }, monitoringEnabled: true, lastSuccessfulSyncAt: null } }),
      db.connectedAccount.count({ where: { tenantId: session.tenantId, status: { not: "disconnected" }, monitoringEnabled: false } }),
    ]);
    return { firstSyncPending, monitoringDisabled };
  });
  const pct = (used: number, limit: number | null) => (limit === null || limit <= 0 ? (used > 0 ? 100 : 0) : Math.round((used / limit) * 100));
  const isOver = (used: number, limit: number | null) => limit !== null && used > limit;
  const overLimit = isOver(resources.connections, planLimits.maxConnectedAccounts) || isOver(resources.brands, planLimits.maxBrands);
  const paymentIssue = billing?.accessState === "restricted" || billing?.billingStatus === "past_due" || billing?.billingStatus === "unpaid";

  return (
    <>
      <PageHeader eyebrow={c.eyebrow} title={c.title} description={c.description} />

      <div data-testid="usage-card" data-status={summary.status}>
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold capitalize" data-testid="usage-plan">{summary.plan} {c.planWord}</span>
            <span data-testid="usage-status"><Badge tone={STATUS_TONE[summary.status]}>{c.statusLabel[summary.status]}</Badge></span>
          </div>
          <span className="text-xs text-[var(--color-muted)]" data-testid="usage-period">
            {fmtDate(summary.periodStart)} – {fmtDate(summary.periodEnd)} · {c.resets} {fmtDate(summary.nextReset)}
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <Meter testid="usage-basic" label={c.meterBasic} used={formatNumber(summary.basic.used)} limit={summary.basic.limit === null ? "∞" : formatNumber(summary.basic.limit)} percent={summary.basic.percent} />
          <Meter testid="usage-premium-calls" label={c.meterCalls} used={formatNumber(summary.premiumCalls.used)} limit={summary.premiumCalls.limit === null ? "∞" : formatNumber(summary.premiumCalls.limit)} percent={summary.premiumCalls.percent} />
          <Meter testid="usage-premium-cost" label={c.meterBudget} used={euros(summary.premiumCost.usedMicros)} limit={summary.premiumCost.limitMicros === null ? "∞" : euros(summary.premiumCost.limitMicros)} percent={summary.premiumCost.percent} />
        </div>

        <p className="mt-4 text-xs text-[var(--color-muted)]" data-testid="usage-copy">
          {c.usageCopy}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs" data-testid="usage-paid-enabled" data-enabled={fuse.effectiveEnabled ? "true" : "false"}>
          <span className={`inline-block h-2 w-2 rounded-full ${fuse.effectiveEnabled ? "bg-[var(--color-ok)]" : "bg-[var(--color-muted)]"}`} />
          <span className="text-[var(--color-muted)]">{c.paidStatus(fuse.effectiveEnabled)}</span>
        </p>
      </Card>
      </div>

      <div data-testid="usage-resources" className="mt-4" data-over-limit={overLimit ? "true" : "false"}>
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold">{c.resourcesTitle}</h3>
        <div className="flex flex-col gap-4">
          <Meter
            testid="usage-connections"
            label={c.meterConnections}
            used={formatNumber(resources.connections)}
            limit={planLimits.maxConnectedAccounts === null ? "∞" : formatNumber(planLimits.maxConnectedAccounts)}
            percent={pct(resources.connections, planLimits.maxConnectedAccounts)}
          />
          <Meter
            testid="usage-brands"
            label={c.meterBrands}
            used={formatNumber(resources.brands)}
            limit={planLimits.maxBrands === null ? "∞" : formatNumber(planLimits.maxBrands)}
            percent={pct(resources.brands, planLimits.maxBrands)}
          />
        </div>
        {overLimit ? (
          <p role="alert" className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]" data-testid="usage-over-limit">
            {c.overLimit}
          </p>
        ) : null}
        {paymentIssue ? (
          <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]" data-testid="usage-payment-issue">
            <span>{c.paymentIssue}</span>
            <Link href="/dashboard/billing" className="font-semibold underline">{c.manageBilling}</Link>
          </p>
        ) : null}
      </Card>
      </div>

      {billing ? (
        <div data-testid="usage-plan-billing" className="mt-4">
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{c.planBillingTitle}</h3>
            <span data-testid="usage-lifecycle" data-lifecycle={billing.lifecycle}>
              <Badge tone={billing.lifecycle === "active_paid" || billing.lifecycle === "active_trial" ? "ok" : billing.lifecycle === "past_due" ? "warn" : "danger"}>{c.lifecycleLabel[billing.lifecycle]}</Badge>
            </span>
          </div>
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-2"><span className="font-medium capitalize">{summary.plan} {c.planWord}</span></div>
            {billing.lifecycle === "active_trial" && billing.trialDaysRemaining !== null ? (
              <p data-testid="usage-trial-days">⏳ {billing.trialDaysRemaining === 0 ? c.trialEndsToday : c.trialDaysLeft(billing.trialDaysRemaining)}</p>
            ) : null}
            {billing.subscription?.currentPeriodEnd ? (
              <p data-testid="usage-next-payment">
                <span className="text-[var(--color-muted)]">{billing.subscription.cancelAtPeriodEnd ? c.cancelsOn : c.nextPayment}:</span>{" "}
                <span className="font-medium tabular-nums">{fmtDate(billing.subscription.currentPeriodEnd)}</span>
              </p>
            ) : null}
          </div>
          {accountStates.firstSyncPending > 0 ? (
            <p className="mt-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]" data-testid="usage-first-sync-pending">
              🕒 {c.firstSyncPending(accountStates.firstSyncPending)}
            </p>
          ) : null}
          {accountStates.monitoringDisabled > 0 ? (
            <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]" data-testid="usage-monitoring-disabled">
              <span>{c.monitoringDisabledByPlan(accountStates.monitoringDisabled)}</span>
              <Link href="/dashboard/billing" className="font-semibold underline">{c.manageBilling}</Link>
            </p>
          ) : null}
        </Card>
        </div>
      ) : null}

      {diag ? (
        <div data-testid="usage-diagnostic" className="mt-4">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">{c.diagnosticTitle} <span className="font-normal text-[var(--color-muted)]">{c.adminOnly}</span></h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            <D label={c.dEffectivePlan}>{diag.policy.plan}</D>
            <D label={c.dPaidFallback}>{String(diag.policy.allowPaidFallback)}</D>
            <D label={c.dGeneratedReplies}>{String(diag.policy.allowGeneratedReplies)}</D>
            <D label={c.dOpenReservations}>{String(diag.reservations)}</D>
            <D label={c.dStaleReservations}>{String(diag.staleReservations)}</D>
            <D label={c.dDenied}>{String(diag.deniedCount)}</D>
            <D label={c.dCacheHitRate}>{`${Math.round(diag.cacheHitRate * 100)}%`}</D>
            <D label={c.dPaidEnabled}>{String(fuse.effectiveEnabled)}</D>
            <D label={c.dGlobalCalls}>{String(fuse.globalDailyCallLimit)}</D>
            <D label={c.dGlobalCost}>{euros(BigInt(fuse.globalDailyCostLimitMicros))}</D>
            <D label={c.dMaxConcurrency}>{String(fuse.maxConcurrency)}</D>
            <D label={c.dRpm}>{String(fuse.rpmLimit)}</D>
          </dl>
        </Card>
        </div>
      ) : null}
    </>
  );
}

function D({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}
