import { PageHeader, Card, SectionHeader, Badge, PrimaryButton, SecondaryButton } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { navItem } from "@/lib/nav";
import { formatNumber } from "@/lib/format";
import { getTL } from "@/i18n/server";
import type { Locale } from "@/i18n";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/billing");

const TRIAL_LIMIT = 500;

const COPY: Record<Locale, { taglines: [string, string, string, string] }> = {
  en: { taglines: ["For getting started", "For growing brands", "For multi-brand teams", "For scale & compliance"] },
  sk: { taglines: ["Pre začiatok", "Pre rastúce značky", "Pre multi-brand tímy", "Pre škálovanie a compliance"] },
  de: { taglines: ["Für den Einstieg", "Für wachsende Marken", "Für Multi-Marken-Teams", "Für Skalierung & Compliance"] },
};

export default async function BillingPage() {
  const session = await requireSession();
  const { locale, t: hdrT } = await getTL();
  const c = COPY[locale];
  const f = hdrT.dash.feat;
  const PLANS = [
    { name: "Starter", note: hdrT.dash.free, tagline: hdrT.pricing.plans[0]?.tagline ?? c.taglines[0], features: [f.brand1, f.accounts2, f.items500, f.readOnlySync, f.communitySupport], cta: hdrT.dash.currentPlan, highlight: false, current: true },
    { name: "Business", note: hdrT.dash.comingSoon, tagline: hdrT.pricing.plans[1]?.tagline ?? c.taglines[1], features: [f.brands5, f.unlimitedAccounts, f.approvalWorkflow, f.insightsReports, f.emailSupport], cta: hdrT.common.getNotified, highlight: true, current: false },
    { name: "Agency", note: hdrT.dash.comingSoon, tagline: hdrT.pricing.plans[2]?.tagline ?? c.taglines[2], features: [f.unlimitedBrands, f.teamRolesSeats, f.auditExports, f.prioritySupport], cta: hdrT.common.getNotified, highlight: false, current: false },
    { name: "Enterprise", note: hdrT.dash.talkToUs, tagline: hdrT.pricing.plans[3]?.tagline ?? c.taglines[3], features: [f.ssoSaml, f.dataResidency, f.sla, f.dedicatedSupport], cta: hdrT.common.contactSales, highlight: false, current: false },
  ];
  const used = await withTenant(session.tenantId, (db) => db.reputationItem.count({ where: { tenantId: session.tenantId } }));
  const pct = Math.min(100, Math.round((used / TRIAL_LIMIT) * 100));

  return (
    <>
      <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={hdrT.dashHeaders[nav.icon].desc} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <div className="flex items-center justify-between">
            <SectionHeader title={hdrT.sidebar.freeTrial} />
            <Badge tone="brand">{hdrT.dash.active}</Badge>
          </div>
          <p className="text-sm text-[var(--color-muted)]">
            {hdrT.dash.freeTrialCopy}
          </p>
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="text-[var(--color-muted)]">{hdrT.dash.itemsProcessed}</span>
              <span className="font-medium">{formatNumber(used)} / {formatNumber(TRIAL_LIMIT)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-[var(--color-muted)]">{pct}% {hdrT.dash.trialAllowanceUsed}</p>
          </div>
        </Card>

        <Card>
          <SectionHeader title={hdrT.dash.usageThisPeriod} />
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: hdrT.dash.itemsCount, value: formatNumber(used) },
              { label: hdrT.dash.brandsCount, value: "—" },
              { label: hdrT.dash.accountsCount, value: "—" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-[var(--color-border)] p-4">
                <p className="text-xs text-[var(--color-muted)]">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold">{s.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[var(--color-muted)]">
            {hdrT.dash.detailedBilling}
          </p>
        </Card>
      </div>

      <div className="mt-8">
        <SectionHeader title={hdrT.dash.plans} description={hdrT.dash.checkoutDisabled} />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`gu-card flex flex-col p-6 ${p.highlight ? "ring-2 ring-[var(--color-brand)]" : ""}`}
            >
              {p.highlight ? <Badge tone="brand">{hdrT.dash.popular}</Badge> : p.current ? <Badge tone="ok">{hdrT.dash.current}</Badge> : <span className="text-xs text-[var(--color-muted)]">{p.tagline}</span>}
              <h3 className="mt-3 text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 text-2xl font-semibold text-[var(--color-brand)]">{p.note}</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">{p.tagline}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="text-[var(--color-ok)]">✓</span>
                    <span className="text-[var(--color-muted)]">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {p.highlight ? (
                  <PrimaryButton type="button" disabled className="w-full">{p.cta}</PrimaryButton>
                ) : (
                  <SecondaryButton type="button" disabled className="w-full">{p.cta}</SecondaryButton>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-[var(--color-muted)]">
          {hdrT.dash.noPaymentProcessed}
        </p>
      </div>
    </>
  );
}
