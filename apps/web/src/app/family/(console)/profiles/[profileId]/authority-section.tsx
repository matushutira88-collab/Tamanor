import { ALL_GUARDIAN_AUTHORITY_TYPES, ALL_GUARDIAN_AUTHORITY_LEVELS } from "@guardora/core";
import type { GuardianAuthorityRecordVM, EffectiveAuthorityDecision, AuthorityTimelineEntryVM } from "@guardora/db";
import { Badge, Field, Select } from "@/components/dashboard/ui";
import { famLabel, type FamilyDict } from "../../../family-i18n";
import { ConfirmDialog } from "../../../confirm-dialog";
import { grantGuardianAuthorityAction, changeGuardianAuthorityLevelAction, resumeGuardianAuthorityAction, suspendGuardianAuthorityAction, revokeGuardianAuthorityAction } from "./authority-actions";

const inputCls = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]";

/**
 * CS-C9 — per-guardian AUTHORITY controls (content-free). Shows status/level + an effective/not-effective
 * badge (with a SAFE reason), plus grant / change-level / suspend / resume / revoke and the authority
 * timeline. Authority is a SEPARATE axis — nothing here changes GuardianRole/relationshipType/FamilyRole.
 * The disclaimer states Tamanor does NOT perform legal identity/document verification.
 */
export function GuardianAuthoritySection({ t, profileId, relationshipId, guardianRoleLabel, records, effective, timeline, canManage }: {
  t: FamilyDict; profileId: string; relationshipId: string; guardianRoleLabel: string;
  records: GuardianAuthorityRecordVM[]; effective: EffectiveAuthorityDecision; timeline: AuthorityTimelineEntryVM[]; canManage: boolean;
}) {
  const c = t.c9;
  // The single manageable (active/suspended) authority for this relationship, if any.
  const active = records.find((r) => (r.authorityStatus === "verified" || r.authorityStatus === "suspended") && r.revokedAt === null && r.archivedAt === null);
  const levelOptions = (ALL_GUARDIAN_AUTHORITY_LEVELS as readonly string[]).map((v) => ({ value: v, label: famLabel(c.levels, v) }));
  const typeOptions = (ALL_GUARDIAN_AUTHORITY_TYPES as readonly string[]).map((v) => ({ value: v, label: famLabel(c.types, v) }));

  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="neutral">{guardianRoleLabel}</Badge>
          {active ? <>
            <Badge tone={active.authorityStatus === "verified" ? "ok" : "warn"}>{famLabel(c.statuses, active.authorityStatus)}</Badge>
            <span className="text-xs text-[var(--color-muted)]">{c.levelLabel}: {famLabel(c.levels, active.authorityLevel)}</span>
          </> : <span className="text-xs text-[var(--color-muted)]">{c.noAuthority}</span>}
        </span>
        <Badge tone={effective.effective ? "ok" : "neutral"}>{effective.effective ? c.effective : c.notEffective}</Badge>
      </div>
      {!effective.effective ? <p className="mt-1 text-xs text-[var(--color-muted)]">{c.effectiveReason}: {famLabel(c.reasons, effective.reason)}</p> : null}

      {canManage && active ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <form action={changeGuardianAuthorityLevelAction} className="flex items-center gap-1">
            <input type="hidden" name="profileId" value={profileId} />
            <input type="hidden" name="authorityId" value={active.id} />
            <Select name="authorityLevel" options={levelOptions} defaultValue={active.authorityLevel} />
            <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">{c.changeLevel}</button>
          </form>
          {active.authorityStatus === "verified" ? (
            <ConfirmDialog action={suspendGuardianAuthorityAction} hiddenName="authorityId" hiddenValue={active.id} extraHidden={{ profileId }} triggerLabel={c.suspend} title={c.suspendDialogTitle} body={c.suspendDialogBody} confirmLabel={c.suspendDialogConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={c.errors} danger />
          ) : (
            <form action={resumeGuardianAuthorityAction}>
              <input type="hidden" name="profileId" value={profileId} />
              <input type="hidden" name="authorityId" value={active.id} />
              <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-brand-strong)] hover:border-[var(--color-brand)]">{c.resume}</button>
            </form>
          )}
          <ConfirmDialog action={revokeGuardianAuthorityAction} hiddenName="authorityId" hiddenValue={active.id} extraHidden={{ profileId }} triggerLabel={c.revoke} title={c.revokeDialogTitle} body={c.revokeDialogBody} confirmLabel={c.revokeDialogConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={c.errors} danger />
        </div>
      ) : null}

      {canManage && !active ? (
        <form action={grantGuardianAuthorityAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="guardianRelationshipId" value={relationshipId} />
          <Field label={c.typeLabel}><Select name="authorityType" required options={typeOptions} defaultValue="legal_guardian" /></Field>
          <Field label={c.levelLabel}><Select name="authorityLevel" required options={levelOptions} defaultValue="read_only" /></Field>
          <div>
            <label className="block text-sm font-medium text-[var(--color-fg)]">{c.expiresLabel} <span className="font-normal text-[var(--color-muted)]">({c.optional})</span></label>
            <input type="date" name="validUntil" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 self-end text-xs text-[var(--color-fg)]">
            <input type="checkbox" name="attestation" value="on" required className="h-4 w-4" />
            <span>{c.attestationLabel}</span>
          </label>
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
