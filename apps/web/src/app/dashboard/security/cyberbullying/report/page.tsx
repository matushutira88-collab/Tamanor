import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canReportCyberbullying, getManualReportFormOptions } from "@/server/cyberbullying-report";
import { getCyberbullyingIncidentDetail } from "@/server/cyberbullying-inbox";
import { CB_COPY } from "../cb-i18n";
import { ManualReportForm } from "./report-form";
import { ReportSuccess } from "./report-success";

export const dynamic = "force-dynamic";

/**
 * C6 — manual report route. Two gates (RBAC report permission → AccessDenied;
 * entitlement → CapabilityLocked) precede any content. `?created=<id>` renders the
 * success screen after verifying the incident is in the caller's scope (reusing the
 * detail read model) — otherwise NotFound. No subjects → a safe empty state (this
 * sprint does NOT create subjects inline).
 */
export default async function CyberbullyingReportPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  if (!canReportCyberbullying(session.role)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale];
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const created = (await searchParams).created;

  const back = <Link href="/dashboard/security/cyberbullying/incidents" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {t.backToInbox}</Link>;

  // Success screen — verify the created incident is visible in the caller's scope.
  if (created) {
    const inc = await getCyberbullyingIncidentDetail(actor, created);
    if (!inc) {
      return (
        <>
          <PageHeader eyebrow="Security · Cyberbullying" title={t.report.title} action={back} />
          <EmptyState title={t.error.notFound} body={t.error.body} />
        </>
      );
    }
    return (
      <>
        <PageHeader eyebrow="Security · Cyberbullying" title={t.report.title} action={back} />
        <ReportSuccess locale={locale} incidentId={inc.id} />
      </>
    );
  }

  const options = await getManualReportFormOptions(actor);

  return (
    <>
      <PageHeader eyebrow="Security · Cyberbullying" title={t.report.title} description={t.report.subtitle} action={back} />
      {options.subjects.length === 0 ? (
        <EmptyState title={t.report.subjectStep.emptyTitle} body={t.report.subjectStep.emptyBody} />
      ) : (
        <div className="max-w-2xl">
          <ManualReportForm locale={locale} subjects={options.subjects} categories={options.categories} />
        </div>
      )}
    </>
  );
}
