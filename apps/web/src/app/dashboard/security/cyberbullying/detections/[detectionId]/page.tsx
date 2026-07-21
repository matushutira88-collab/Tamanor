import Link from "next/link";
import { PageHeader, Card, Badge, SectionHeader, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canTriageDetections, getCyberbullyingDetectionDetail } from "@/server/cyberbullying-detections";
import { listReportableSubjects } from "@guardora/db";
import { MANUAL_REPORT_LIMITS } from "@guardora/core";
import { CB_COPY } from "../../cb-i18n";
import { detectionTriageAction, createIncidentFromDetectionAction } from "../actions";

export const dynamic = "force-dynamic";

const statusTone = (s: string): "ok" | "brand" | "neutral" => (s === "linked_to_incident" ? "ok" : s === "new" || s === "under_review" ? "brand" : "neutral");
const sevTone = (s: string): "danger" | "warn" | "neutral" => (s === "critical" || s === "high" ? "danger" : s === "medium" ? "warn" : "neutral");
const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]";
const INPUT = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]";

export default async function DetectionDetailPage({ params, searchParams }: { params: Promise<{ detectionId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  if (!canTriageDetections(session.role)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale];
  const d = t.det;
  const { detectionId } = await params;
  const { ok, err } = await searchParams;
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const det = await getCyberbullyingDetectionDetail(actor, detectionId);
  const back = <Link href="/dashboard/security/cyberbullying/detections" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {d.back}</Link>;

  if (!det) return (<><PageHeader eyebrow="Security · Cyberbullying" title={d.detailTitle} action={back} /><EmptyState title={d.empty.title} body={t.error.body} /></>);

  const a = det.actions;
  const subjects = a.createIncident ? await listReportableSubjects(actor) : [];
  const banner = err ? (d.banner[err as keyof typeof d.banner] ?? d.banner.error) : ok ? d.banner.ok : null;
  const meta = (k: string, v: string | number | null) => (
    <div className="flex justify-between gap-3 border-b border-[var(--color-border)] py-1.5 text-sm last:border-0"><span className="text-[var(--color-muted)]">{k}</span><span className="text-right text-[var(--color-fg)]">{v === null || v === "" ? "—" : String(v)}</span></div>
  );
  const opForm = (op: string, label: string) => (
    <form action={detectionTriageAction}><input type="hidden" name="detectionId" value={det.id} /><input type="hidden" name="op" value={op} /><button type="submit" className={BTN}>{label}</button></form>
  );

  return (
    <>
      <PageHeader eyebrow="Security · Cyberbullying" title={d.detailTitle}
        action={<div className="flex items-center gap-3"><Badge tone={statusTone(det.status)}>{d.status[det.status as keyof typeof d.status] ?? det.status}</Badge>{back}</div>} />

      {banner ? <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${err ? "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "border-[var(--color-ok)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]"}`}>{banner}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <SectionHeader title={d.section.overview} action={<Badge tone={sevTone(det.severity)}>{d.severity[det.severity as keyof typeof d.severity] ?? det.severity}</Badge>} />
            {meta(d.meta.detectedAt, new Date(det.detectedAt).toISOString().slice(0, 16).replace("T", " "))}
            {meta(d.meta.kind, det.kind)}
            {meta(d.meta.source, det.source)}
            {meta(d.meta.subject, `${det.subjectType}: ${det.subjectId}`)}
            {meta(d.meta.occurrences, det.occurrenceCount)}
            {meta(d.meta.reasonCode, det.reasonCode)}
            {meta(d.meta.confidence, det.confidence)}
            {det.linked && det.incidentId ? (
              <div className="mt-3"><Link href={`/dashboard/security/cyberbullying/incidents/${det.incidentId}`} className="text-sm font-semibold text-[var(--color-brand)] hover:underline">{d.viewIncident} →</Link></div>
            ) : null}
          </Card>

          {/* Triage actions — only what this reviewer may do (server-computed). */}
          <Card>
            <SectionHeader title={d.section.actions} />
            {!a.startReview && !a.ignore && !a.falsePositive && !a.reopen && !a.createIncident ? (
              <p className="text-sm text-[var(--color-muted)]">{det.linked ? d.linked : "—"}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {a.startReview ? opForm("start_review", d.op.start_review) : null}
                {a.ignore ? opForm("ignore", d.op.ignore) : null}
                {a.falsePositive ? opForm("false_positive", d.op.false_positive) : null}
                {a.reopen ? opForm("reopen", d.op.reopen) : null}
              </div>
            )}
          </Card>

          {/* Create incident — explicit human action (subject + summary). */}
          {a.createIncident ? (
            <Card>
              <SectionHeader title={d.section.createIncident} />
              <p className="mb-3 text-xs text-[var(--color-muted)]">{d.create.note}</p>
              {subjects.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{d.create.noSubjects}</p>
              ) : (
                <form action={createIncidentFromDetectionAction} className="space-y-3">
                  <input type="hidden" name="detectionId" value={det.id} />
                  <label className="block text-xs font-semibold text-[var(--color-fg)]">{d.create.subject}
                    <select name="protectedSubjectId" required className={`${INPUT} mt-1`} defaultValue="">
                      <option value="" disabled>{d.create.choose}</option>
                      {subjects.map((s) => <option key={s.id} value={s.id}>{s.displayLabel}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-[var(--color-fg)]">{d.create.summary}
                    <p className="my-1 font-normal text-[var(--color-muted)]">{d.create.summaryHint}</p>
                    <textarea name="summary" required minLength={MANUAL_REPORT_LIMITS.summaryMin} maxLength={MANUAL_REPORT_LIMITS.summaryMax} rows={4} className={INPUT} />
                  </label>
                  <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{d.create.submit}</button>
                </form>
              )}
            </Card>
          ) : null}
        </div>

        {/* Triage history */}
        <Card>
          <SectionHeader title={d.section.timeline} />
          {det.timeline.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{d.empty.noTimeline}</p>
          ) : (
            <ul className="space-y-2.5">
              {det.timeline.map((e) => (
                <li key={e.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{d.timelineEvent[e.eventType as keyof typeof d.timelineEvent] ?? e.eventType}</span>
                    <span className="text-xs text-[var(--color-muted)]">{new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">{e.hasActor ? "" : t.system}{e.reason && e.reason.startsWith("incident:") ? "" : e.reason ? ` · ${t.reason}: ${e.reason}` : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
