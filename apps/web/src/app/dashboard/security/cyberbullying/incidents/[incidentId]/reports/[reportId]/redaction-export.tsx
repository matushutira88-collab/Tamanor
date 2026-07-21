import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Card, Badge, SectionHeader } from "@/components/dashboard/ui";
import type { Locale } from "@/i18n/config";
import { ExportPurposeCode, RecipientType } from "@guardora/core";
import type { DraftVM, AuthorizationVM, ManifestVM } from "@guardora/db";
import { CB_COPY } from "../../../../cb-i18n";
import { createDraftAction, cancelDraftAction, requestAuthAction, approveAuthAction, rejectAuthAction, cancelAuthAction, prepareManifestAction } from "./redaction-actions";

const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";
const INPUT = "rounded-lg border border-[var(--color-border-strong)] bg-white px-2 py-1.5 text-xs";
const PRIMARY = "rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]";

export function RedactionExport({ locale, incidentId, reportId, isRedacted, canRedact, canApprove, canExport, workflow, banner }: {
  locale: Locale; incidentId: string; reportId: string; isRedacted: boolean; canRedact: boolean; canApprove: boolean; canExport: boolean;
  workflow: { drafts: DraftVM[]; authorizations: AuthorizationVM[]; manifests: ManifestVM[] }; banner: string | null;
}) {
  const t = CB_COPY[locale].red;
  const hidden = <><input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="reportId" value={reportId} /></>;

  return (
    <div id="redact" className="mt-8 scroll-mt-20">
      <SectionHeader title={t.section} description={t.subtitle} />
      {banner ? <div role={banner === t.banner.ok ? "status" : "alert"} aria-live="polite" className={`mb-4 rounded-lg border px-3 py-2 text-sm ${banner === t.banner.ok ? "border-[var(--color-ok)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]" : "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]"}`}>{banner}</div> : null}
      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.fourEyesNote}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Redaction drafts */}
        <Card>
          <SectionHeader title={t.drafts} action={!isRedacted && canRedact ? (
            <form action={createDraftAction}>{hidden}<input type="hidden" name="idempotencyKey" value={randomUUID()} /><button type="submit" className={PRIMARY}>{t.createDraft}</button></form>
          ) : undefined} />
          {workflow.drafts.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.noItems}</p> : (
            <ul className="space-y-2">
              {workflow.drafts.map((d) => (
                <li key={d.draftId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2"><Badge tone={d.status === "approved" ? "ok" : d.status === "rejected" || d.status === "cancelled" ? "neutral" : "brand"}>{t.draftStatus[d.status as keyof typeof t.draftStatus] ?? d.status}</Badge></span>
                  <span className="flex gap-1.5">
                    {d.status === "draft" || d.status === "submitted" ? <Link href={`/dashboard/security/cyberbullying/incidents/${incidentId}/reports/${reportId}/redact/${d.draftId}`} className={BTN}>{t.workspace}</Link> : null}
                    {d.producedReportId ? <Link href={`/dashboard/security/cyberbullying/incidents/${incidentId}/reports/${d.producedReportId}`} className={BTN}>{t.draftStatus.approved}</Link> : null}
                    {(d.status === "draft" || d.status === "submitted") && canRedact ? <form action={cancelDraftAction}>{hidden}<input type="hidden" name="draftId" value={d.draftId} /><button type="submit" className={BTN}>{t.cancel}</button></form> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Export authorizations */}
        <Card>
          <SectionHeader title={t.authorizations} />
          {isRedacted && canRedact ? (
            <form action={requestAuthAction} className="mb-4 space-y-2 border-b border-[var(--color-border)] pb-4">
              {hidden}
              <label className="block text-xs font-semibold">{t.purpose}
                <select name="purposeCode" className={`${INPUT} mt-1 block w-full`}>{Object.values(ExportPurposeCode).map((p) => <option key={p} value={p}>{t.purposeLabel[p]}</option>)}</select>
              </label>
              <label className="block text-xs font-semibold">{t.recipient}
                <select name="recipientType" className={`${INPUT} mt-1 block w-full`}>{Object.values(RecipientType).map((rt) => <option key={rt} value={rt}>{t.recipientLabelMap[rt]}</option>)}</select>
              </label>
              <label className="block text-xs font-semibold">{t.recipientLabel}<input name="recipientLabel" className={`${INPUT} mt-1 block w-full`} /></label>
              <button type="submit" className={PRIMARY}>{t.requestAuth}</button>
            </form>
          ) : null}
          {workflow.authorizations.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.noItems}</p> : (
            <ul className="space-y-2">
              {workflow.authorizations.map((a) => (
                <li key={a.authorizationId} className="rounded-lg border border-[var(--color-border)] p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><Badge tone={a.status === "approved" ? "ok" : a.status === "requested" ? "brand" : "neutral"}>{t.authStatus[a.status] ?? a.status}</Badge><span className="text-xs">{t.purposeLabel[a.purposeCode] ?? a.purposeCode}</span></span>
                    <span className="text-[10px] text-[var(--color-muted)]">{t.expires}: {a.expiresAt.slice(0, 10)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.status === "requested" && canExport ? <><form action={approveAuthAction}>{hidden}<input type="hidden" name="authorizationId" value={a.authorizationId} /><button type="submit" className={BTN}>{t.approveAuth}</button></form>
                      <form action={rejectAuthAction}>{hidden}<input type="hidden" name="authorizationId" value={a.authorizationId} /><input type="hidden" name="reasonCode" value="OTHER" /><button type="submit" className={BTN}>{t.rejectAuth}</button></form></> : null}
                    {(a.status === "requested" || a.status === "approved") && canExport ? <form action={cancelAuthAction}>{hidden}<input type="hidden" name="authorizationId" value={a.authorizationId} /><button type="submit" className={BTN}>{t.cancelAuth}</button></form> : null}
                    {a.status === "approved" && canExport ? <form action={prepareManifestAction}>{hidden}<input type="hidden" name="authorizationId" value={a.authorizationId} /><input type="hidden" name="idempotencyKey" value={randomUUID()} /><button type="submit" className={PRIMARY}>{t.prepareManifest}</button></form> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Package manifests */}
      {workflow.manifests.length > 0 ? (
        <Card className="mt-6 overflow-x-auto">
          <SectionHeader title={t.manifests} />
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[var(--color-muted)]"><tr className="border-b border-[var(--color-border)]"><th className="py-2 pr-3">{t.packageVersion}</th><th className="py-2 pr-3">{t.verification}</th><th className="py-2">Hash</th></tr></thead>
            <tbody>{workflow.manifests.map((m) => (
              <tr key={m.manifestId} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-2 pr-3">v{m.packageVersion}</td>
                <td className="py-2 pr-3"><Badge tone={m.verification === "verified" ? "ok" : "danger"}>{CB_COPY[locale].comp.verification[m.verification as keyof (typeof CB_COPY)[Locale]["comp"]["verification"]] ?? m.verification}</Badge></td>
                <td className="py-2 select-all break-all font-mono text-[10px] text-[var(--color-muted)]">{m.manifestHash.slice(0, 24)}…</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
