import { listSafetySignals } from "@guardora/db";
import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge, EmptyState } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../family-i18n";

export const dynamic = "force-dynamic";
function fmt(d: Date): string { return new Date(d).toISOString().slice(0, 16).replace("T", " "); }

export default async function FamilySignalsPage() {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const page = await listSafetySignals(actor, { limit: 50 });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t.signals.title} description={t.signals.disclaimer} />
      <Card>
        <SectionHeader title={t.signals.title} />
        {page.items.length === 0 ? (
          <EmptyState title={t.dash.emptyTitle} body={t.signals.emptyText} hint={t.privacy.integrations} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3 font-medium">{t.signals.type}</th>
                  <th className="py-2 pr-3 font-medium">{t.signals.severity}</th>
                  <th className="py-2 pr-3 font-medium">{t.signals.confidence}</th>
                  <th className="py-2 pr-3 font-medium">{t.signals.bucket}</th>
                  <th className="py-2 pr-3 font-medium">{t.signals.review}</th>
                  <th className="py-2 font-medium">{t.signals.created}</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--color-border)]">
                    <td className="py-2.5 pr-3"><Badge tone={s.severity === "critical" || s.severity === "high" ? "warn" : "neutral"}>{famLabel(t.labels.signalType, s.signalType)}</Badge></td>
                    <td className="py-2.5 pr-3">{famLabel(t.labels.severity, s.severity)}</td>
                    <td className="py-2.5 pr-3">{famLabel(t.labels.confidence, s.confidenceBand)}</td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--color-muted)]">{s.occurrenceBucket ?? "—"}</td>
                    <td className="py-2.5 pr-3">{famLabel(t.labels.reviewStatus, s.reviewStatus)}</td>
                    <td className="py-2.5 text-xs text-[var(--color-muted)]">{fmt(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--color-muted)]">{t.signals.disclaimer}</p>
      </Card>
    </div>
  );
}
