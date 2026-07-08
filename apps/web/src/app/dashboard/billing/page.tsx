import { PageHeader, Card, SectionHeader, Badge, PrimaryButton, SecondaryButton } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/billing");

const TRIAL_LIMIT = 500;

const PLANS = [
  { name: "Starter", note: "Free", tagline: "For getting started", features: ["1 brand", "2 connected accounts", "500 items / mo", "Read-only sync", "Community support"], cta: "Current plan", highlight: false, current: true },
  { name: "Business", note: "Coming soon", tagline: "For growing brands", features: ["5 brands", "Unlimited accounts", "Approval workflow", "Insights & reports", "Email support"], cta: "Get notified", highlight: true, current: false },
  { name: "Agency", note: "Coming soon", tagline: "For multi-brand teams", features: ["Unlimited brands", "Team roles & seats", "Audit exports", "Priority support"], cta: "Get notified", highlight: false, current: false },
  { name: "Enterprise", note: "Talk to us", tagline: "For scale & compliance", features: ["SSO / SAML", "Data residency", "SLA", "Dedicated support"], cta: "Contact sales", highlight: false, current: false },
];

export default async function BillingPage() {
  const session = await requireSession();
  const used = await prisma.reputationItem.count({ where: { tenantId: session.tenantId } });
  const pct = Math.min(100, Math.round((used / TRIAL_LIMIT) * 100));

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <div className="flex items-center justify-between">
            <SectionHeader title="Free trial" />
            <Badge tone="brand">Active</Badge>
          </div>
          <p className="text-sm text-[var(--color-muted)]">
            You're on the free trial. No card required.
          </p>
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="text-[var(--color-muted)]">Items processed</span>
              <span className="font-medium">{used.toLocaleString()} / {TRIAL_LIMIT.toLocaleString()}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-[var(--color-muted)]">{pct}% of your monthly trial allowance used.</p>
          </div>
        </Card>

        <Card>
          <SectionHeader title="Usage this period" />
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Items", value: used.toLocaleString() },
              { label: "Brands", value: "—" },
              { label: "Accounts", value: "—" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-[var(--color-border)] p-4">
                <p className="text-xs text-[var(--color-muted)]">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold">{s.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[var(--color-muted)]">
            Detailed billing & invoices arrive with paid plans.
          </p>
        </Card>
      </div>

      <div className="mt-8">
        <SectionHeader title="Plans" description="Pricing is being finalized — checkout is not enabled yet." />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`gu-card flex flex-col p-6 ${p.highlight ? "ring-2 ring-[var(--color-brand)]" : ""}`}
            >
              {p.highlight ? <Badge tone="brand">Popular</Badge> : p.current ? <Badge tone="ok">Current</Badge> : <span className="text-xs text-[var(--color-muted)]">{p.tagline}</span>}
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
          No payment is processed. Checkout and invoices arrive when paid plans launch.
        </p>
      </div>
    </>
  );
}
