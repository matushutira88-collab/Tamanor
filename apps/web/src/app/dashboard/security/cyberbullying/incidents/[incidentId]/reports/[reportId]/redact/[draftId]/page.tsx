import Link from "next/link";
import { PageHeader, Card, Badge, SectionHeader, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { can, Role, Permission, COMPLIANCE_REDACTABLE_FIELDS, ALL_REDACTION_REASONS, RedactionRejectionReason, ReplacementMarker, getRedactableField } from "@guardora/core";
import { getComplianceRedactionDraft, previewComplianceRedaction } from "@guardora/db";
import { CB_COPY } from "../../../../../../cb-i18n";
import { addRuleAction, removeRuleAction, submitDraftAction, approveDraftAction, rejectDraftAction } from "../../redaction-actions";

export const dynamic = "force-dynamic";

const INPUT = "rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-xs";
const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";

export default async function RedactionWorkspacePage({ params, searchParams }: { params: Promise<{ incidentId: string; reportId: string; draftId: string }>; searchParams: Promise<{ xok?: string; xerr?: string }> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  if (!can(session.role as Role, Permission.CyberbullyingComplianceRedact)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale].red;
  const { incidentId, reportId, draftId } = await params;
  const sp = await searchParams;
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const draft = await getComplianceRedactionDraft(actor, draftId).catch(() => null);
  const reportPath = `/dashboard/security/cyberbullying/incidents/${incidentId}/reports/${reportId}`;
  const back = <Link href={`${reportPath}#redact`} className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {t.back}</Link>;

  if (!draft) return (<><PageHeader eyebrow="Security · Cyberbullying" title={t.workspace} action={back} /><EmptyState title={t.banner.not_found} body="" /></>);

  const preview = draft.status === "draft" || draft.status === "submitted" ? await previewComplianceRedaction(actor, draftId).catch(() => null) : null;
  const canApprove = can(session.role as Role, Permission.CyberbullyingComplianceApprove);
  const isAuthor = draft.createdByUserId === session.userId;
  const hidden = <><input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="reportId" value={reportId} /><input type="hidden" name="draftId" value={draftId} /></>;
  const banner = sp.xerr ? (t.banner[sp.xerr as keyof typeof t.banner] ?? t.banner.error) : sp.xok === "1" ? t.banner.ok : null;

  return (
    <>
      <PageHeader eyebrow="Security · Cyberbullying" title={t.workspace} description={t.fourEyesNote}
        action={<div className="flex items-center gap-3"><Badge tone={draft.status === "approved" ? "ok" : draft.status === "submitted" ? "brand" : "neutral"}>{t.draftStatus[draft.status as keyof typeof t.draftStatus] ?? draft.status}</Badge>{back}</div>} />
      {banner ? <div role="alert" aria-live="polite" className={`mb-4 rounded-lg border px-3 py-2 text-sm ${sp.xerr ? "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "border-[var(--color-ok)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]"}`}>{banner}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {/* Rules */}
          <Card>
            <SectionHeader title={t.rules} />
            {draft.rules.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.noRules}</p> : (
              <ul className="space-y-2">
                {draft.rules.map((r) => (
                  <li key={r.ruleId} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                    <span className="min-w-0"><span className="font-mono text-xs">{r.fieldPath}</span> · <span className="text-[var(--color-muted)]">{t.actionLabel[r.action as keyof typeof t.actionLabel] ?? r.action}</span> · <span className="text-xs">{t.reasonLabel[r.reasonCode] ?? r.reasonCode}</span></span>
                    {draft.status === "draft" ? <form action={removeRuleAction}>{hidden}<input type="hidden" name="ruleId" value={r.ruleId} /><button type="submit" className={BTN}>{t.removeRule}</button></form> : null}
                  </li>
                ))}
              </ul>
            )}
            {draft.status === "draft" ? (
              <form action={addRuleAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--color-border)] pt-4">
                {hidden}
                <label className="text-xs font-semibold">{t.fieldPath}
                  <select name="fieldPath" className={`${INPUT} mt-1 block`}>{COMPLIANCE_REDACTABLE_FIELDS.map((f) => <option key={f.fieldPath} value={f.fieldPath}>{f.fieldPath}</option>)}</select>
                </label>
                <label className="text-xs font-semibold">{t.action}
                  <select name="action" className={`${INPUT} mt-1 block`}>{["remove", "replace_with_label", "mask_identifier", "keep"].map((a) => <option key={a} value={a}>{t.actionLabel[a as keyof typeof t.actionLabel]}</option>)}</select>
                </label>
                <label className="text-xs font-semibold">{t.reason}
                  <select name="reasonCode" className={`${INPUT} mt-1 block`}>{ALL_REDACTION_REASONS.map((rc) => <option key={rc} value={rc}>{t.reasonLabel[rc] ?? rc}</option>)}</select>
                </label>
                <label className="text-xs font-semibold">{t.marker}
                  <select name="replacementMarkerKey" className={`${INPUT} mt-1 block`}><option value="">—</option>{Object.values(ReplacementMarker).map((m) => <option key={m} value={m}>{m}</option>)}</select>
                </label>
                <input name="reasonNote" placeholder={t.note} className={`${INPUT} min-w-[8rem] flex-1`} />
                <button type="submit" className={BTN}>{t.addRule}</button>
              </form>
            ) : null}
          </Card>

          {/* Actions */}
          <Card>
            <SectionHeader title={t.action} />
            <div className="flex flex-wrap gap-2">
              {draft.status === "draft" ? <form action={submitDraftAction}>{hidden}<button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{t.submit}</button></form> : null}
              {/* Four-eyes: the author never sees an enabled approve; the server rejects it regardless. */}
              {draft.status === "submitted" && canApprove && !isAuthor ? (
                <>
                  <form action={approveDraftAction}>{hidden}<button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{t.approve}</button></form>
                  <form action={rejectDraftAction} className="flex items-end gap-1">{hidden}<select name="reasonCode" className={INPUT}>{Object.values(RedactionRejectionReason).map((rr) => <option key={rr} value={rr}>{t.rejectReason[rr] ?? rr}</option>)}</select><button type="submit" className={BTN}>{t.reject}</button></form>
                </>
              ) : null}
              {draft.status === "submitted" && isAuthor ? <p className="text-xs text-[var(--color-muted)]">{t.fourEyesNote}</p> : null}
            </div>
          </Card>
        </div>

        {/* Preview */}
        <Card>
          <SectionHeader title={t.previewTitle} />
          {preview ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-[var(--color-muted)]">{t.diff.removed}</dt><dd>{preview.diff.removedCount}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-muted)]">{t.diff.replaced}</dt><dd>{preview.diff.replacedCount}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-muted)]">{t.diff.masked}</dt><dd>{preview.diff.maskedCount}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-muted)]">{t.diff.kept}</dt><dd>{preview.diff.keptSensitiveCount}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-muted)]">{t.diff.unresolved}</dt><dd><Badge tone={preview.unresolvedHighlySensitive.length ? "danger" : "ok"}>{preview.unresolvedHighlySensitive.length + preview.unresolvedSensitive.length}</Badge></dd></div>
              {preview.unresolvedHighlySensitive.length ? <p className="mt-2 text-xs text-[var(--color-danger)]">{preview.unresolvedHighlySensitive.map((f) => (getRedactableField(f)?.displayLabelKey ?? f)).join(", ")}</p> : null}
            </dl>
          ) : <p className="text-sm text-[var(--color-muted)]">—</p>}
        </Card>
      </div>
    </>
  );
}
