import Link from "next/link";
import { PageHeader, Card, Badge, SectionHeader, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canManageCase } from "@/server/cyberbullying-case";
import { getComplianceReportDetail } from "@guardora/db";
import { CB_COPY } from "../../../../cb-i18n";

export const dynamic = "force-dynamic";

const verifyTone = (v: string): "ok" | "danger" | "warn" | "neutral" => (v === "verified" ? "ok" : v === "invalid" ? "danger" : v === "unsupported_schema" || v === "chain_incomplete" ? "warn" : "neutral");

/** Render a sanitized payload object/array as an accessible read-only table (no JSON dump, no download). */
function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--color-muted)]">—</p>;
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[var(--color-muted)]"><tr className="border-b border-[var(--color-border)]">{cols.map((c) => <th key={c} className="py-1.5 pr-3 font-medium">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
              {cols.map((c) => <td key={c} className="py-1.5 pr-3">{r[c] === null || r[c] === undefined ? "—" : String(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function KeyVals({ obj }: { obj: Record<string, unknown> }) {
  return (
    <dl className="space-y-1 text-sm">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-[var(--color-border)] py-1 last:border-0">
          <dt className="text-[var(--color-muted)]">{k}</dt>
          <dd className="max-w-[60%] break-words text-right text-[var(--color-fg)]">{v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ComplianceReportDetailPage({ params }: { params: Promise<{ incidentId: string; reportId: string }> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  if (!canManageCase(session.role)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale];
  const c = t.comp;
  const { incidentId, reportId } = await params;
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const report = await getComplianceReportDetail(actor, reportId).catch(() => null);
  const back = <Link href={`/dashboard/security/cyberbullying/incidents/${incidentId}#reports`} className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {c.back}</Link>;

  if (!report) return (<><PageHeader eyebrow="Security · Cyberbullying" title={c.section} action={back} /><EmptyState title={c.empty} body={t.error.body} /></>);

  const p = report.payload;
  const verified = report.verificationStatus;

  return (
    <>
      <PageHeader eyebrow="Security · Cyberbullying" title={`${c.reportType[report.reportType as keyof typeof c.reportType] ?? report.reportType} · v${report.version}`} description={c.readOnly}
        action={<div className="flex items-center gap-3"><Badge tone={verifyTone(verified)}>{c.verification[verified as keyof typeof c.verification] ?? verified}</Badge>{back}</div>} />

      {verified === "invalid" || verified === "chain_incomplete" || verified === "unsupported_schema" ? (
        <div role="alert" className="mb-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{c.invalidWarning}</div>
      ) : null}

      <div className="space-y-6">
        <Card><SectionHeader title={c.sections.metadata} /><KeyVals obj={{ ...p.reportMetadata, sourceSystems: p.reportMetadata.sourceSystems.join(", ") }} /></Card>
        <Card><SectionHeader title={c.sections.incident} /><KeyVals obj={p.incident as unknown as Record<string, unknown>} /></Card>
        <Card><SectionHeader title={c.sections.protectedSubject} /><KeyVals obj={p.protectedSubject as unknown as Record<string, unknown>} /></Card>
        <Card><SectionHeader title={c.sections.assignments} /><KeyVals obj={{ primaryReviewerUserId: p.assignments.primaryReviewerUserId }} /><div className="mt-3"><DataTable rows={p.assignments.participants as unknown as Record<string, unknown>[]} /></div></Card>
        <Card><SectionHeader title={c.sections.detections} /><DataTable rows={p.detections as unknown as Record<string, unknown>[]} /></Card>
        <Card><SectionHeader title={c.sections.evidence} /><DataTable rows={p.evidenceInventory as unknown as Record<string, unknown>[]} /></Card>
        <Card><SectionHeader title={c.sections.custody} /><DataTable rows={p.custodySummary as unknown as Record<string, unknown>[]} /></Card>
        <Card><SectionHeader title={c.sections.chronology} /><DataTable rows={p.chronology.map((e) => ({ occurredAt: e.occurredAt, category: e.category, type: e.type, actorUserId: e.actorUserId, entityRef: e.entityRef })) as unknown as Record<string, unknown>[]} /></Card>
        <Card><SectionHeader title={c.sections.caseManagement} />
          <KeyVals obj={{ protectionStatus: p.caseManagement.protection?.protectionStatus ?? "—", riskLevel: p.caseManagement.protection?.riskLevel ?? "—", nextReviewAt: p.caseManagement.followUp?.nextReviewAt ?? "—", lastReviewAt: p.caseManagement.followUp?.lastReviewAt ?? "—" }} />
          <div className="mt-3 grid gap-4 md:grid-cols-2"><div><p className="mb-1 text-xs font-semibold">tasks</p><DataTable rows={p.caseManagement.tasks as unknown as Record<string, unknown>[]} /></div><div><p className="mb-1 text-xs font-semibold">milestones</p><DataTable rows={p.caseManagement.milestones as unknown as Record<string, unknown>[]} /></div></div>
        </Card>
        <Card><SectionHeader title={c.sections.sla} /><KeyVals obj={{ ...p.slaAndEscalation, activeEscalation: p.slaAndEscalation.activeEscalation ? JSON.stringify(p.slaAndEscalation.activeEscalation) : "—" }} /></Card>
        <Card><SectionHeader title={c.sections.integrity} />
          <KeyVals obj={{ ...p.integrity, [c.hash]: report.snapshotHash, [c.previousHash]: report.previousSnapshotHash ?? "—" }} />
          <p className="mt-2 select-all break-all font-mono text-xs text-[var(--color-muted)]">{report.snapshotHash}</p>
        </Card>
        <Card><SectionHeader title={c.sections.omissions} />
          {p.omissions.length === 0 ? <p className="text-sm text-[var(--color-muted)]">—</p> : (
            <ul className="space-y-1 text-sm">{p.omissions.map((o, i) => <li key={i} className="flex justify-between gap-3"><span className="text-[var(--color-fg)]">{c.omission[o.reason] ?? o.reason}</span><span className="font-mono text-xs text-[var(--color-muted)]">{o.path}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
