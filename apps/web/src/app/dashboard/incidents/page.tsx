import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, string> = { critical: "danger", high: "danger", medium: "warn", low: "neutral" };

export default async function IncidentsPage() {
  const t = await getT();
  const session = await requireSession();
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };

  // V1.37.5 — related-item count from the referentially-integral join table.
  const incidents = await withTenant(session.tenantId, (db) => db.incident.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100, include: { _count: { select: { relatedItems: true } } } }));

  return (
    <>
      <PageHeader title={t.cc.incidentsTitle} description={t.cc.incidentsSubtitle} />

      {incidents.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm font-medium">✅ {t.cc.noIncidents}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.cc.incidentsEmptyBody}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => (
            <Card key={inc.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONE[inc.severity] ?? "neutral"}>{inc.severity}</Badge>
                  <span className="font-medium">{inc.title}</span>
                  <Badge>{tEnum(t, "autoProtectCategory", inc.category)}</Badge>
                </div>
                <Badge tone={inc.status === "open" ? "warn" : "ok"}>{inc.status}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--color-muted)]">
                <span>{t.cc.related}: {inc._count.relatedItems}</span>
                {inc.sourcePlatform ? <span>{inc.sourcePlatform}</span> : null}
                <span>{formatDateTime(inc.createdAt)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
