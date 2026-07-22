import { ALL_CONSENT_TYPES, ConsentType } from "@guardora/core";
import type { ConsentRecordVM, EffectiveConsentDecision, ConsentTimelineEntryVM } from "@guardora/db";
import { Badge, Field, Select } from "@/components/dashboard/ui";
import { famLabel, type FamilyDict } from "../../../family-i18n";
import { ConfirmDialog } from "../../../confirm-dialog";
import { grantConsentAction, resumeConsentAction, suspendConsentAction, revokeConsentAction } from "./consent-actions";

const inputCls = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]";

/**
 * CS-C10 — per-guardian CONSENT controls (content-free). Consent is a SEPARATE domain layer: a guardian
 * with authority but without effective consent is NOT an authorized recipient. Shows status + an
 * effective/not-effective badge (safe reason), grant / suspend / resume / revoke, and the consent timeline.
 */
export function GuardianConsentSection({ t, profileId, relationshipId, guardianRoleLabel, records, effective, timeline, canManage }: {
  t: FamilyDict; profileId: string; relationshipId: string; guardianRoleLabel: string;
  records: ConsentRecordVM[]; effective: EffectiveConsentDecision; timeline: ConsentTimelineEntryVM[]; canManage: boolean;
}) {
  const c = t.c10;
  const active = records.find((r) => (r.consentStatus === "active" || r.consentStatus === "suspended") && r.revokedAt === null && r.archivedAt === null);
  const typeOptions = (ALL_CONSENT_TYPES as readonly string[]).map((v) => ({ value: v, label: famLabel(c.types, v) }));

  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="neutral">{guardianRoleLabel}</Badge>
          {active ? <>
            <Badge tone={active.consentStatus === "active" ? "ok" : "warn"}>{famLabel(c.statuses, active.consentStatus)}</Badge>
            <span className="text-xs text-[var(--color-muted)]">{c.typeLabel}: {famLabel(c.types, active.consentType)}</span>
          </> : <span className="text-xs text-[var(--color-muted)]">{c.noConsent}</span>}
        </span>
        <Badge tone={effective.effective ? "ok" : "neutral"}>{effective.effective ? c.effective : c.notEffective}</Badge>
      </div>
      {!effective.effective ? <p className="mt-1 text-xs text-[var(--color-muted)]">{c.effectiveReason}: {famLabel(c.reasons, effective.reason)}</p> : null}

      {canManage && active ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {active.consentStatus === "active" ? (
            <ConfirmDialog action={suspendConsentAction} hiddenName="consentId" hiddenValue={active.id} extraHidden={{ profileId }} triggerLabel={c.suspend} title={c.suspendDialogTitle} body={c.suspendDialogBody} confirmLabel={c.suspendDialogConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={c.errors} danger />
          ) : (
            <form action={resumeConsentAction}>
              <input type="hidden" name="profileId" value={profileId} />
              <input type="hidden" name="consentId" value={active.id} />
              <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-brand-strong)] hover:border-[var(--color-brand)]">{c.resume}</button>
            </form>
          )}
          <ConfirmDialog action={revokeConsentAction} hiddenName="consentId" hiddenValue={active.id} extraHidden={{ profileId }} triggerLabel={c.revoke} title={c.revokeDialogTitle} body={c.revokeDialogBody} confirmLabel={c.revokeDialogConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={c.errors} danger />
        </div>
      ) : null}

      {canManage && !active ? (
        <form action={grantConsentAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="guardianRelationshipId" value={relationshipId} />
          <Field label={c.typeLabel}><Select name="consentType" required options={typeOptions} defaultValue={ConsentType.Guardian} /></Field>
          <div>
            <label className="block text-sm font-medium text-[var(--color-fg)]">{c.expiresLabel} <span className="font-normal text-[var(--color-muted)]">({c.optional})</span></label>
            <input type="date" name="validUntil" className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{c.grant}</button>
          </div>
        </form>
      ) : null}

      {timeline.length > 0 ? (
        <ol className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
          {timeline.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-[var(--color-fg)]">{c.events[e.event] ?? e.event.split(".").slice(-1)[0]?.replace(/_/g, " ")}</span>
              <span className="text-[var(--color-muted)]">{new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
