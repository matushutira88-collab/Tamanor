import Link from "next/link";
import { PageHeader, Card, Badge, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canViewCyberbullying, listCyberbullyingIncidentInbox, getCyberbullyingFilterOptions, type InboxFilters, type InboxSort } from "@/server/cyberbullying-inbox";
import { CB_COPY, statusTone } from "../cb-i18n";
import { IncidentLifecycleStatus } from "@guardora/core";

export const dynamic = "force-dynamic";

const STATUSES = Object.values(IncidentLifecycleStatus) as string[];
const SORTS: InboxSort[] = ["newest", "oldest", "recently_updated", "status_priority"];

type SP = Record<string, string | undefined>;

export default async function CyberbullyingInboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  if (!canViewCyberbullying(session.role)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale];
  const sp = await searchParams;
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const filters: InboxFilters = {
    status: sp.status && STATUSES.includes(sp.status) ? sp.status : undefined,
    reportSource: sp.source === "manual_report" || sp.source === "detection" ? sp.source : undefined,
    protectedSubjectId: sp.subject || undefined,
    evidence: sp.evidence === "has" || sp.evidence === "none" ? sp.evidence : undefined,
    detections: sp.detections === "has" || sp.detections === "manual_only" ? sp.detections : undefined,
    tfDays: [7, 30, 90].includes(Number(sp.tf)) ? Number(sp.tf) : undefined,
    search: sp.search || undefined,
  };
  const sort: InboxSort = (SORTS as string[]).includes(sp.sort ?? "") ? (sp.sort as InboxSort) : "newest";
  const page = Math.max(1, Number(sp.page) || 1);
  const hasFilters = Object.values(filters).some((v) => v != null && v !== "");

  const [result, options] = await Promise.all([
    listCyberbullyingIncidentInbox(actor, { filters, sort, page }),
    getCyberbullyingFilterOptions(actor),
  ]);

  const detailHref = (id: string) => `/dashboard/security/cyberbullying/incidents/${id}` as const;
  const pageHref = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]);
    q.set("page", String(p));
    return `/dashboard/security/cyberbullying/incidents?${q.toString()}` as const;
  };
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <PageHeader eyebrow="Security · Cyberbullying" title={t.inboxTitle} description={t.inboxSubtitle}
        action={<Link href="/dashboard/security/cyberbullying" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {t.overviewTitle}</Link>} />

      {/* Filters — server-side GET form (no client business logic). */}
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-xs">{t.filter.status}
            <select name="status" defaultValue={sp.status ?? ""} className="mt-1 block rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="">{t.filter.all}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t.status[s]}</option>)}
            </select>
          </label>
          <label className="text-xs">{t.filter.source}
            <select name="source" defaultValue={sp.source ?? ""} className="mt-1 block rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="">{t.filter.all}</option>
              <option value="manual_report">{t.reportSource.manual_report}</option>
              <option value="detection">{t.reportSource.detection}</option>
            </select>
          </label>
          <label className="text-xs">{t.filter.subject}
            <select name="subject" defaultValue={sp.subject ?? ""} className="mt-1 block rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="">{t.filter.all}</option>
              {options.subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="text-xs">{t.filter.evidence}
            <select name="evidence" defaultValue={sp.evidence ?? ""} className="mt-1 block rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="">{t.filter.all}</option>
              <option value="has">{t.filter.hasEvidence}</option>
              <option value="none">{t.filter.noEvidence}</option>
            </select>
          </label>
          <label className="text-xs">{t.filter.detections}
            <select name="detections" defaultValue={sp.detections ?? ""} className="mt-1 block rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="">{t.filter.all}</option>
              <option value="has">{t.filter.hasDetections}</option>
              <option value="manual_only">{t.filter.manualOnly}</option>
            </select>
          </label>
          <label className="text-xs">{t.filter.sort}
            <select name="sort" defaultValue={sort} className="mt-1 block rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="newest">{t.sort.newest}</option>
              <option value="oldest">{t.sort.oldest}</option>
              <option value="recently_updated">{t.sort.recentlyUpdated}</option>
              <option value="status_priority">{t.sort.statusPriority}</option>
            </select>
          </label>
          <label className="text-xs">{t.filter.search}
            <input name="search" defaultValue={sp.search ?? ""} className="mt-1 block rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-sm" />
          </label>
          <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-3 py-2 text-xs font-semibold text-[var(--color-brand-fg)]">{t.filter.status}</button>
          <Link href="/dashboard/security/cyberbullying/incidents" className="px-2 py-2 text-xs text-[var(--color-muted)] hover:underline">{t.filter.reset}</Link>
        </form>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState title={hasFilters ? t.empty.filterTitle : t.empty.noIncidentsTitle} body={hasFilters ? t.empty.filterBody : t.empty.noIncidentsBody}
          action={hasFilters ? <Link href="/dashboard/security/cyberbullying/incidents" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">{t.filter.reset}</Link> : undefined} />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-2)] text-left text-xs text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5">{t.col.subject}</th>
                  <th className="px-4 py-2.5">{t.col.status}</th>
                  <th className="px-4 py-2.5">{t.col.source}</th>
                  <th className="px-4 py-2.5">{t.col.allegedActor}</th>
                  <th className="px-4 py-2.5 text-right">{t.col.detections}</th>
                  <th className="px-4 py-2.5 text-right">{t.col.evidence}</th>
                  <th className="px-4 py-2.5">{t.col.created}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-4 py-2.5"><Link href={detailHref(r.id)} className="font-medium text-[var(--color-brand)] hover:underline">{r.subjectLabel ?? r.id.slice(0, 8)}</Link></td>
                    <td className="px-4 py-2.5"><Badge tone={statusTone(r.status)}>{t.status[r.status] ?? r.status}</Badge></td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{r.reportSource ? t.reportSource[r.reportSource] : "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{r.allegedActorLabel ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.detectionCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.evidenceCount}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-muted)]">{new Date(r.createdAt).toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>{t.pageOf(result.page, result.total)}</span>
            <div className="flex gap-2">
              {result.page > 1 ? <Link href={pageHref(result.page - 1)} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 hover:bg-[var(--color-surface-2)]">{t.prev}</Link> : null}
              {result.page < totalPages ? <Link href={pageHref(result.page + 1)} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 hover:bg-[var(--color-surface-2)]">{t.next}</Link> : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
