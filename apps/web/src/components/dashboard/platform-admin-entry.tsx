import Link from "next/link";
import { Card } from "./ui";

/**
 * Platform Administration ENTRY card for the tenant dashboard. PRESENTATIONAL only — the owner-only decision is
 * made server-side in the page (it renders this component ONLY for a platform owner), so for every other role
 * this markup is never produced and is absent from the client HTML. The CTA links to /admin, whose own
 * server-side guard is enforced independently of this card.
 */
export interface PlatformAdminMetrics {
  activeTenants: number;
  activeUsers: number;
  unresolvedSecurityIncidents: number;
  recentAuditEvents: number;
}

export interface PlatformAdminEntryCopy {
  title: string;
  description: string;
  cta: string;
  mTenants: string;
  mUsers: string;
  mIncidents: string;
  mAudit: string;
}

export function PlatformAdminEntry({ copy, metrics }: { copy: PlatformAdminEntryCopy; metrics: PlatformAdminMetrics | null }) {
  return (
    <section aria-label={copy.title} data-testid="platform-admin-entry" className="mt-8">
      <Card className="border-[var(--color-brand)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span aria-hidden="true">🛰️</span>
              <h2 className="text-lg font-semibold text-[var(--color-fg)]">{copy.title}</h2>
            </div>
            <p className="mt-1 max-w-prose text-sm text-[var(--color-muted)]">{copy.description}</p>
          </div>
          <Link
            href="/admin"
            data-testid="platform-admin-cta"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          >
            {copy.cta} <span aria-hidden="true">→</span>
          </Link>
        </div>

        {metrics ? (
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label={copy.mTenants} value={metrics.activeTenants} />
            <Metric label={copy.mUsers} value={metrics.activeUsers} />
            <Metric label={copy.mIncidents} value={metrics.unresolvedSecurityIncidents} danger={metrics.unresolvedSecurityIncidents > 0} />
            <Metric label={copy.mAudit} value={metrics.recentAuditEvents} />
          </dl>
        ) : null}
      </Card>
    </section>
  );
}

function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold ${danger ? "text-[var(--color-danger)]" : "text-[var(--color-fg)]"}`}>{value}</dd>
    </div>
  );
}
