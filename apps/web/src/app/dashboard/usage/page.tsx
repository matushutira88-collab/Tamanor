import { requireSession } from "@/server/auth";
import { withTenant, getUsageSummary, getUsageDiagnostic, type UsageStatus } from "@guardora/db";
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
  const tenant = await withTenant(session.tenantId, (db) => db.tenant.findUnique({ where: { id: session.tenantId }, select: { plan: true } }));
  const plan = tenant?.plan ?? "free";
  const summary = await getUsageSummary(session.tenantId, plan);
  const fuse = getPaidAiFuseConfig();
  const isAdmin = session.role === "owner" || session.role === "admin";
  const diag = isAdmin ? await getUsageDiagnostic(session.tenantId, plan) : null;
  const locale = await getLocale();
  const c = COPY[locale];

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
