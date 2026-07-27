import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import {
  canViewChildSafetyPilot, canManageChildSafetyPilot, canReviewChildSafetyPilot,
  canActivateChildSafetyPilot, canSuspendChildSafetyPilot, canViewChildSafetyPilotAudit,
  NON_WAIVABLE_CHECKS,
} from "@guardora/core";
import { systemDb, getPartnerPilot, type PilotActor } from "@guardora/db";
import { PILOT_COPY } from "../pilot-i18n";
import { PilotDetailControls } from "./pilot-detail-controls";
import { pilotStatusTone, readinessTone, severityTone, checkStatusTone, testResultTone, assessmentTone, statusGlyph, fmtDate } from "../pilot-view";
import { Unauthorized } from "../unauthorized";

export const dynamic = "force-dynamic";

export default async function PilotDetailPage({ params }: { params: Promise<{ pilotId: string }> }) {
  const { pilotId } = await params;
  const locale = await getLocale();
  const t = PILOT_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canViewChildSafetyPilot(session.role)) return <Unauthorized t={t} />;
  const membership = await systemDb.membership.findFirst({ where: { userId: session.userId, tenantId: session.tenantId }, select: { id: true } });
  if (!membership) return <Unauthorized t={t} />;
  const actor: PilotActor = { tenantId: session.tenantId, userId: session.userId, membershipId: membership.id, role: session.role };

  const detail = await getPartnerPilot(actor, pilotId).catch(() => null);
  if (!detail) notFound();
  const { pilot, checks, testRuns, contacts, events, alerts } = detail;
  const caps = {
    manage: canManageChildSafetyPilot(session.role), review: canReviewChildSafetyPilot(session.role),
    activate: canActivateChildSafetyPilot(session.role), suspend: canSuspendChildSafetyPilot(session.role), audit: canViewChildSafetyPilotAudit(session.role),
  };
  const nonWaivable = new Set(NON_WAIVABLE_CHECKS as readonly string[]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader eyebrow="🚦" title={t.title} description={`${pilot.environment} · ${t.statusLabel[pilot.status] ?? pilot.status}`} />
        <Link href="/dashboard/child-safety/integrations/pilots" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">← {t.title}</Link>
      </div>

      <Card className="grid gap-1.5 p-4 text-xs text-[var(--color-muted)]">
        {t.privacyWarnings.map((w, i) => <p key={i}>⚠️ {w}</p>)}
      </Card>

      {/* Lifecycle controls (client; confirmations for high-impact actions) */}
      <PilotDetailControls t={t} pilot={pilot} caps={caps} />

      {/* Overview */}
      <section aria-label={t.sections.overview} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.overview}</h2>
        <Card className="grid grid-cols-2 gap-3 p-4 text-xs sm:grid-cols-4">
          <Field label={t.fields.status}><Badge tone={pilotStatusTone(pilot.status)}><span aria-hidden="true">{statusGlyph(pilotStatusTone(pilot.status))} </span>{t.statusLabel[pilot.status] ?? pilot.status}</Badge></Field>
          <Field label={t.fields.readiness}><Badge tone={readinessTone(pilot.readinessState)}>{t.readinessLabel[pilot.readinessState] ?? pilot.readinessState}</Badge></Field>
          <Field label={t.fields.requestedAt}>{fmtDate(pilot.requestedAt)}</Field>
          <Field label={t.fields.version}>{pilot.version}</Field>
          <Field label={t.fields.startDate}>{fmtDate(pilot.pilotStartDate)}</Field>
          <Field label={t.fields.reviewDate}>{fmtDate(pilot.pilotReviewDate)}</Field>
          <Field label={t.fields.endDate}>{fmtDate(pilot.pilotEndDate)}</Field>
          <Field label={t.fields.volumeBand}>{pilot.monthlyVolumeBand ? (t.bandLabel[pilot.monthlyVolumeBand] ?? pilot.monthlyVolumeBand) : "—"}</Field>
        </Card>
      </section>

      {/* Scope */}
      <section aria-label={t.sections.scope} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.scope}</h2>
        <Card className="grid grid-cols-1 gap-2 p-4 text-xs sm:grid-cols-2">
          <Field label={t.fields.capabilities}>{pilot.approvedCapabilities.join(", ") || "—"}</Field>
          <Field label={t.fields.categories}>{pilot.approvedRiskCategories.join(", ") || "—"}</Field>
          <Field label={t.fields.rateBand}>{pilot.peakRateBand ? (t.bandLabel[pilot.peakRateBand] ?? pilot.peakRateBand) : "—"}</Field>
          <Field label="Age bands">{pilot.approvedAgeBands.join(", ") || "—"}</Field>
        </Card>
      </section>

      {/* Assessments */}
      <section aria-label={t.sections.assessments} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.assessments}</h2>
        <Card className="grid grid-cols-2 gap-3 p-4 text-xs sm:grid-cols-4">
          <Field label="Privacy"><Badge tone={assessmentTone(pilot.privacyAssessmentStatus)}>{t.assessmentLabel[pilot.privacyAssessmentStatus] ?? pilot.privacyAssessmentStatus}</Badge></Field>
          <Field label="Security"><Badge tone={assessmentTone(pilot.securityAssessmentStatus)}>{t.assessmentLabel[pilot.securityAssessmentStatus] ?? pilot.securityAssessmentStatus}</Badge></Field>
          <Field label="Legal"><Badge tone={assessmentTone(pilot.legalAuthorizationStatus)}>{t.assessmentLabel[pilot.legalAuthorizationStatus] ?? pilot.legalAuthorizationStatus}</Badge></Field>
          <Field label="Operational"><Badge tone={assessmentTone(pilot.operationalReadinessStatus)}>{t.assessmentLabel[pilot.operationalReadinessStatus] ?? pilot.operationalReadinessStatus}</Badge></Field>
        </Card>
      </section>

      {/* Readiness checklist + blocking reasons */}
      <section aria-label={t.sections.readiness} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.readiness}</h2>
        {pilot.readinessBlocking.length > 0 ? (
          <Card className="border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-xs">
            <p className="font-semibold text-[var(--color-danger)]">{t.fields.readiness}: {t.readinessLabel[pilot.readinessState]}</p>
            <ul className="mt-1 list-disc pl-5 text-[var(--color-danger)]">{pilot.readinessBlocking.map((b) => <li key={b}>{t.blockingLabel[b] ?? b}</li>)}</ul>
          </Card>
        ) : <p className="text-xs text-[var(--color-muted)]">{t.fields.noBlocking}</p>}
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <caption className="sr-only">{t.sections.readiness}</caption>
              <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2 font-semibold">Check</th><th scope="col" className="px-3 py-2 font-semibold">{t.fields.status}</th><th scope="col" className="px-3 py-2 font-semibold">{t.fields.comment}</th></tr></thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.checkType} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2">{t.checkLabel[c.checkType] ?? c.checkType} {nonWaivable.has(c.checkType) ? <span className="ml-1 rounded bg-[var(--color-neutral-soft)] px-1 text-[10px] text-[var(--color-muted)]">{t.nonWaivable}</span> : null}</td>
                    <td className="px-3 py-2"><Badge tone={checkStatusTone(c.status)}>{t.checkStatusLabel[c.status] ?? c.status}</Badge></td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{c.boundedComment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* Compatibility tests */}
      <section aria-label={t.sections.tests} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.tests}</h2>
        <Card className="overflow-hidden p-0">
          {testRuns.length === 0 ? <div className="p-4 text-xs text-[var(--color-muted)]">{t.fields.empty}</div> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-xs"><caption className="sr-only">{t.sections.tests}</caption>
              <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2 font-semibold">Test</th><th scope="col" className="px-3 py-2 font-semibold">Result</th><th scope="col" className="px-3 py-2 font-semibold">{t.fields.when}</th></tr></thead>
              <tbody>{testRuns.map((r) => <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-2">{t.testTypeLabel[r.testType] ?? r.testType}</td><td className="px-3 py-2"><Badge tone={testResultTone(r.result)}>{t.testResultLabel[r.result] ?? r.result}</Badge></td><td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">{fmtDate(r.startedAt)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      </section>

      {/* Operational contacts (review/manage only) */}
      {caps.review ? (
        <section aria-label={t.sections.contacts} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.contacts}</h2>
          <Card className="p-4 text-xs">
            {contacts.length === 0 ? <p className="text-[var(--color-muted)]">{t.fields.empty}</p> : (
              <ul className="space-y-1">{contacts.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2"><Badge tone="neutral">{t.contactRoleLabel[c.role] ?? c.role}</Badge><span>{c.displayName}</span><span className="font-mono text-[var(--color-muted)]">{c.businessEmail}</span>{!c.active ? <span className="text-[var(--color-muted)]">(inactive)</span> : null}</li>)}</ul>
            )}
          </Card>
        </section>
      ) : null}

      {/* Operational alerts */}
      <section aria-label={t.sections.alerts} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.alerts}</h2>
        <Card className="overflow-hidden p-0">
          {alerts.length === 0 ? <div className="p-4 text-xs text-[var(--color-muted)]">{t.fields.empty}</div> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-xs"><caption className="sr-only">{t.sections.alerts}</caption>
              <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2 font-semibold">Alert</th><th scope="col" className="px-3 py-2 font-semibold">Severity</th><th scope="col" className="px-3 py-2 font-semibold">{t.fields.status}</th><th scope="col" className="px-3 py-2 font-semibold">{t.fields.count}</th></tr></thead>
              <tbody>{alerts.map((a) => <tr key={a.id} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-2">{t.alertTypeLabel[a.alertType] ?? a.alertType}</td><td className="px-3 py-2"><Badge tone={severityTone(a.severity)}>{t.severityLabel[a.severity] ?? a.severity}</Badge></td><td className="px-3 py-2 text-[var(--color-muted)]">{a.status}</td><td className="px-3 py-2 text-[var(--color-muted)]">{a.count}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      </section>

      {/* Immutable activity history (audit_view only) */}
      {caps.audit ? (
        <section aria-label={t.sections.history} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.history}</h2>
          <Card className="p-4 text-xs">
            {events.length === 0 ? <p className="text-[var(--color-muted)]">{t.fields.empty}</p> : (
              <ol className="space-y-1">{events.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-2"><span className="font-mono text-[var(--color-muted)]">{fmtDate(e.createdAt)}</span><Badge tone="neutral">{e.eventType}</Badge>{e.toStatus ? <span className="text-[var(--color-muted)]">→ {t.statusLabel[e.toStatus] ?? e.toStatus}</span> : null}{e.reasonCode ? <span className="text-[var(--color-muted)]">({e.reasonCode})</span> : null}</li>)}</ol>
            )}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</span>
      <span className="text-[var(--color-fg)]">{children}</span>
    </div>
  );
}
