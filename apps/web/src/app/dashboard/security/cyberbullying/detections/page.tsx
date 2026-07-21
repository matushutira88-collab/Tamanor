import Link from "next/link";
import { PageHeader, Card, Badge, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canTriageDetections, getCyberbullyingDetectionQueue, type DetectionFilters, type DetectionSort } from "@/server/cyberbullying-detections";
import { CyberbullyingDetectionStatus, SecurityDetectionSubjectType, RiskLevel } from "@guardora/core";
import { CB_COPY } from "../cb-i18n";
import { bulkTriageAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUSES = Object.values(CyberbullyingDetectionStatus) as string[];
const SEVERITIES = Object.values(RiskLevel) as string[];
const SUBJECT_TYPES = Object.values(SecurityDetectionSubjectType) as string[];
const SORTS: DetectionSort[] = ["newest", "oldest", "severity", "status"];
type SP = Record<string, string | undefined>;

const statusTone = (s: string): "ok" | "brand" | "neutral" => (s === "linked_to_incident" ? "ok" : s === "new" || s === "under_review" ? "brand" : "neutral");
const sevTone = (s: string): "danger" | "warn" | "neutral" => (s === "critical" || s === "high" ? "danger" : s === "medium" ? "warn" : "neutral");

export default async function DetectionQueuePage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  if (!canTriageDetections(session.role)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale];
  const d = t.det;
  const sp = await searchParams;
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const filters: DetectionFilters = {
    status: sp.status && STATUSES.includes(sp.status) ? sp.status : undefined,
    severity: sp.severity && SEVERITIES.includes(sp.severity) ? sp.severity : undefined,
    kind: sp.kind || undefined,
    subjectType: sp.subject && SUBJECT_TYPES.includes(sp.subject) ? sp.subject : undefined,
    search: sp.search || undefined,
  };
  const sort: DetectionSort = (SORTS as string[]).includes(sp.sort ?? "") ? (sp.sort as DetectionSort) : "newest";
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await getCyberbullyingDetectionQueue(actor, { filters, sort, page });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  const detail = (id: string) => `/dashboard/security/cyberbullying/detections/${id}`;
  const pageHref = (p: number) => { const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]); q.set("page", String(p)); return `/dashboard/security/cyberbullying/detections?${q.toString()}`; };
  const banner = sp.err ? (d.banner[sp.err as keyof typeof d.banner] ?? d.banner.error) : sp.applied != null ? `${d.banner.applied} (${sp.applied}/${Number(sp.applied) + Number(sp.skipped ?? 0)})` : null;
  const sel = "rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-sm";
  const bulkBtn = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";

  return (
    <>
      <PageHeader eyebrow="Security · Cyberbullying" title={d.queueTitle} description={d.queueSubtitle}
        action={<Link href="/dashboard/security/cyberbullying" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {t.overviewTitle}</Link>} />

      {banner ? <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${sp.err ? "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "border-[var(--color-ok)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]"}`}>{banner}</div> : null}

      {/* Filters — server-side GET form */}
      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-xs">{d.filter.status}<select name="status" defaultValue={sp.status ?? ""} className={`mt-1 block ${sel}`}><option value="">{d.filter.all}</option>{STATUSES.map((s) => <option key={s} value={s}>{d.status[s as keyof typeof d.status]}</option>)}</select></label>
          <label className="text-xs">{d.filter.severity}<select name="severity" defaultValue={sp.severity ?? ""} className={`mt-1 block ${sel}`}><option value="">{d.filter.all}</option>{SEVERITIES.map((s) => <option key={s} value={s}>{d.severity[s as keyof typeof d.severity] ?? s}</option>)}</select></label>
          <label className="text-xs">{d.filter.subject}<select name="subject" defaultValue={sp.subject ?? ""} className={`mt-1 block ${sel}`}><option value="">{d.filter.all}</option>{SUBJECT_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label className="text-xs">{d.filter.sort}<select name="sort" defaultValue={sort} className={`mt-1 block ${sel}`}>{SORTS.map((s) => <option key={s} value={s}>{d.sort[s]}</option>)}</select></label>
          <label className="text-xs">{d.filter.search}<input name="search" defaultValue={sp.search ?? ""} className={`mt-1 block ${sel}`} /></label>
          <button type="submit" className={bulkBtn}>{d.filter.status}</button>
          <Link href="/dashboard/security/cyberbullying/detections" className="text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-fg)]">{d.filter.reset}</Link>
        </form>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState title={d.empty.title} body={d.empty.body} />
      ) : (
        // Bulk POST form: checkboxes + op-named submit buttons (no client JS).
        <form action={bulkTriageAction}>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="w-8 py-2"><span className="sr-only">select</span></th>
                  <th className="py-2 pr-3">{d.col.time}</th><th className="py-2 pr-3">{d.col.kind}</th><th className="py-2 pr-3">{d.col.severity}</th>
                  <th className="py-2 pr-3">{d.col.target}</th><th className="py-2 pr-3">{d.col.source}</th><th className="py-2 pr-3">{d.col.status}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((it) => (
                  <tr key={it.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2"><input type="checkbox" name="id" value={it.id} aria-label={`select ${it.id}`} /></td>
                    <td className="py-2 pr-3 text-xs text-[var(--color-muted)]">{new Date(it.detectedAt).toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td className="py-2 pr-3"><Link href={detail(it.id)} className="font-medium text-[var(--color-brand)] hover:underline">{it.kind}</Link></td>
                    <td className="py-2 pr-3"><Badge tone={sevTone(it.severity)}>{d.severity[it.severity as keyof typeof d.severity] ?? it.severity}</Badge></td>
                    <td className="py-2 pr-3 text-xs">{it.subjectType}: {it.subjectId.slice(0, 12)}</td>
                    <td className="py-2 pr-3 text-xs">{it.source ?? "—"}</td>
                    <td className="py-2 pr-3"><span className="flex items-center gap-1"><Badge tone={statusTone(it.status)}>{d.status[it.status as keyof typeof d.status] ?? it.status}</Badge>{it.linked ? <Badge tone="ok">{d.linked}</Badge> : null}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--color-muted)]">{d.bulk.none}</span>
            <button type="submit" name="op" value="start_review" className={bulkBtn}>{d.bulk.startReview}</button>
            <button type="submit" name="op" value="ignore" className={bulkBtn}>{d.bulk.ignore}</button>
            <button type="submit" name="op" value="false_positive" className={bulkBtn}>{d.bulk.falsePositive}</button>
          </div>
        </form>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-[var(--color-muted)]">{t.pageOf(result.page, result.total)}</span>
          <div className="flex gap-2">
            {result.page > 1 ? <Link href={pageHref(result.page - 1)} className={bulkBtn}>{t.prev}</Link> : null}
            {result.page < totalPages ? <Link href={pageHref(result.page + 1)} className={bulkBtn}>{t.next}</Link> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
