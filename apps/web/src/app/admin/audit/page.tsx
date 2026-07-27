import Link from "next/link";
import { getLocale } from "@/i18n/locale-server";
import { Card, PageHeader, Badge } from "@/components/dashboard/ui";
import { requirePlatformAccess } from "@/server/platform/guard";
import { listPlatformAudit } from "@guardora/db";
import { ADMIN_COPY } from "../admin-i18n";
import { Unauthorized } from "../unauthorized";
import { fmtDate } from "../admin-view";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = ADMIN_COPY[await getLocale()];
  const sp = await searchParams;
  const platform = await requirePlatformAccess("audit.view");
  if (!platform) return <Unauthorized t={t} />;

  const page = Math.max(1, Number(sp.page) || 1);
  const audit = await listPlatformAudit(platform.userId, { action: sp.action, result: sp.result, page, pageSize: 40 });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="📜" title={t.nav.audit} description={audit.redactedActor ? "Actor identity is redacted for your role." : t.restrictedBanner} />

      {/* Filters (action) */}
      <div role="group" aria-label={t.fields.action} className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <Link href="/admin/audit" aria-current={!sp.action ? "true" : undefined} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${!sp.action ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border border-[var(--color-border-strong)]"}`}>All</Link>
        {(["admin_user.role_changed", "admin_user.deactivated", "analytics.exported", "admin.access_denied"] as const).map((a) => (
          <Link key={a} href={`/admin/audit?action=${a}`} aria-current={sp.action === a ? "true" : undefined} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${sp.action === a ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border border-[var(--color-border-strong)]"}`}>{t.auditActionLabel[a] ?? a}</Link>
        ))}
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-xs"><caption className="sr-only">{t.nav.audit}</caption>
          <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2">{t.fields.when}</th><th scope="col" className="px-3 py-2">{t.fields.action}</th><th scope="col" className="px-3 py-2">{t.fields.actor}</th><th scope="col" className="px-3 py-2">{t.fields.result}</th></tr></thead>
          <tbody>
            {audit.items.length === 0 ? <tr><td colSpan={4} className="px-4 py-3 text-[var(--color-muted)]">{t.fields.empty}</td></tr> : audit.items.map((a) => (
              <tr key={a.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2 whitespace-nowrap text-[var(--color-muted)]">{fmtDate(a.createdAt)}</td>
                <td className="px-3 py-2">{t.auditActionLabel[a.action] ?? a.action}</td>
                <td className="px-3 py-2 font-mono text-[var(--color-muted)]">{a.actorUserId ? a.actorUserId.slice(0, 10) : "—"}</td>
                <td className="px-3 py-2"><Badge tone={a.resultCode === "ok" ? "ok" : "warn"}>{a.resultCode}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {audit.hasMore ? <div className="text-center"><Link href={`/admin/audit?page=${page + 1}${sp.action ? `&action=${sp.action}` : ""}`} className="text-xs font-medium text-[var(--color-brand-strong)] hover:underline">Next →</Link></div> : null}
    </div>
  );
}
