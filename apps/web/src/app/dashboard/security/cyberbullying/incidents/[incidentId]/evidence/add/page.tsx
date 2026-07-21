import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canUploadEvidence, getEvidenceUploadContext } from "@/server/cyberbullying-evidence";
import { CB_COPY } from "../../../../cb-i18n";
import { EvidenceUploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

/**
 * C7 — evidence upload route. Gates in order (each a truthful state, no data query
 * on denial): RBAC review permission → entitlement → subject-scope access →
 * attachable lifecycle status. Only then renders the client uploader. The actual
 * upload posts to a dedicated route handler (large multipart body).
 */
export default async function AddEvidencePage({ params }: { params: Promise<{ incidentId: string }> }) {
  const locale = await getLocale();
  const t = CB_COPY[locale];
  const session = await requireVerifiedSession();
  if (!canUploadEvidence(session.role)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const { incidentId } = await params;
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const ctx = await getEvidenceUploadContext(actor, incidentId);

  const back = <Link href={`/dashboard/security/cyberbullying/incidents/${incidentId}`} className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {t.evUpload.backToIncident}</Link>;
  const header = <PageHeader eyebrow="Security · Cyberbullying" title={t.evUpload.title} description={t.evUpload.subtitle} action={back} />;

  if (!ctx) {
    return (<>{header}<EmptyState title={t.evUpload.notFoundTitle} body={t.error.body} /></>);
  }
  if (!ctx.canAttach) {
    return (<>{header}<EmptyState title={t.evUpload.closedTitle} body={t.evUpload.closedBody} /></>);
  }

  return (
    <>
      {header}
      <EvidenceUploadForm locale={locale} incidentId={incidentId} />
    </>
  );
}
