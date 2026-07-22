import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProtectedProfile, listRelationshipsForProfile, listFamilyMembers, listProfileTimeline,
  listConsentRecords, listSafetySignals, guardianLifecycleState, isActiveGuardianRelationship,
  listGuardianAuthorityRecords, evaluateEffectiveGuardianAuthority, listGuardianAuthorityTimeline,
  listGuardianConsents, evaluateEffectiveGuardianConsent, listGuardianConsentTimeline, FamilyNotFoundError,
} from "@guardora/db";
import {
  ALL_AGE_BANDS, ProtectionStatus, PROFILE_LANGUAGES, ALL_GUARDIAN_ROLES,
  GuardianRelationshipType, GuardianAuthorityLevel, FamilyAction,
} from "@guardora/core";
import { requireFamilyConsole, familyCan } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge, Field, Input, Select, PrimaryButton } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../../family-i18n";
import { ConfirmDialog } from "../../../confirm-dialog";
import { updateProtectedProfileAction, archiveProtectedProfileAction, restoreProtectedProfileAction } from "../actions";
import { createGuardianRelationshipAction, updateGuardianRoleAction, deactivateGuardianRelationshipAction, reactivateGuardianRelationshipAction } from "./actions";
import { GuardianAuthoritySection } from "./authority-section";
import { GuardianConsentSection } from "./consent-section";
import { ConsentType } from "@guardora/core";

export const dynamic = "force-dynamic";
function fmt(d: Date | null): string { return d ? new Date(d).toISOString().slice(0, 10) : "—"; }
type SP = { ok?: string; e?: string };

export default async function ProfileDetailPage({ params, searchParams }: { params: Promise<{ profileId: string }>; searchParams: Promise<SP> }) {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const { profileId } = await params;
  const sp = await searchParams;
  const canManage = familyCan(actor, FamilyAction.ProtectedProfileManage);
  const canGuardian = familyCan(actor, FamilyAction.GuardianRelationshipManage);

  let profile;
  try { profile = await getProtectedProfile(actor, profileId); }
  catch (e) { if (e instanceof FamilyNotFoundError) notFound(); throw e; }

  const [rels, members, timeline, consents, signals] = await Promise.all([
    listRelationshipsForProfile(actor, profileId, { includeInactive: true }),
    canGuardian ? listFamilyMembers(actor) : Promise.resolve([]),
    listProfileTimeline(actor, profileId),
    listConsentRecords(actor, profileId, { includeInactive: true }),
    listSafetySignals(actor, { protectedProfileId: profileId, includeArchived: true, limit: 20 }),
  ]);

  // CS-C9 — authority data per ACTIVE guardian (records + effective decision + timeline).
  const canManageAuthority = familyCan(actor, FamilyAction.FamilyAuthorityGrant);
  const activeGuardians = rels.filter((r) => isActiveGuardianRelationship(r));
  const authorityData = await Promise.all(activeGuardians.map(async (r) => ({
    rel: r,
    records: await listGuardianAuthorityRecords(actor, r.id, { includeInactive: true }),
    effective: await evaluateEffectiveGuardianAuthority(actor, r.id),
    timeline: await listGuardianAuthorityTimeline(actor, r.id),
  })));
  // CS-C10 — consent data per ACTIVE guardian (the "guardian" consent type + effective decision + timeline).
  const canManageConsent = familyCan(actor, FamilyAction.ConsentManage);
  const consentData = await Promise.all(activeGuardians.map(async (r) => ({
    rel: r,
    records: await listGuardianConsents(actor, r.id, { includeInactive: true }),
    effective: await evaluateEffectiveGuardianConsent(actor, r.id, ConsentType.Guardian),
    timeline: await listGuardianConsentTimeline(actor, r.id),
  })));

  const archived = profile.archivedAt !== null;
  const banner = sp.ok ? { tone: "ok" as const, msg: sp.ok } : sp.e ? { tone: "danger" as const, msg: t.actionErrors[sp.e] ?? t.c9.errors[sp.e] ?? t.c10.errors[sp.e] ?? t.actionErrors.retry_later } : null;
  const ageOptions = (ALL_AGE_BANDS as readonly string[]).map((v) => ({ value: v, label: famLabel(t.labels.ageBand, v) }));
  const statusOptions = Object.values(ProtectionStatus).map((v) => ({ value: v, label: famLabel(t.labels.protectionStatus, v) }));
  const langOptions = [{ value: "", label: t.c7.languageAuto }, ...(PROFILE_LANGUAGES as readonly string[]).map((v) => ({ value: v, label: v.toUpperCase() }))];
  const roleOptions = (ALL_GUARDIAN_ROLES as readonly string[]).map((v) => ({ value: v, label: famLabel(t.c7.roles, v) }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={profile.guardianLabel ?? famLabel(t.labels.ageBand, profile.ageBand)}
        description={`${famLabel(t.labels.ageBand, profile.ageBand)} · ${archived ? t.profiles.archived : famLabel(t.labels.protectionStatus, profile.protectionStatus)}`}
        action={<Link href="/family/profiles" className="text-sm text-[var(--color-brand-strong)]">← {t.profiles.title}</Link>}
      />
      {banner ? <p role={banner.tone === "danger" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm border-[var(--color-${banner.tone})] bg-[var(--color-${banner.tone}-soft)] text-[var(--color-${banner.tone})]`}>{banner.msg}</p> : null}

      {/* CS-C7 — edit (active) or restore (archived) */}
      {canManage && !archived && (
        <Card>
          <SectionHeader title={t.c7.editTitle} />
          <p className="mb-3 text-xs text-[var(--color-muted)]">{t.c7.noPiiHint}</p>
          <form action={updateProtectedProfileAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="profileId" value={profile.id} />
            <Field label={t.profiles.label}><Input name="guardianLabel" maxLength={80} defaultValue={profile.guardianLabel ?? ""} placeholder={t.profiles.newLabel} /></Field>
            <Field label={t.profiles.ageBand}><Select name="ageBand" options={ageOptions} defaultValue={profile.ageBand} /></Field>
            <Field label={t.profiles.status}><Select name="protectionStatus" options={statusOptions} defaultValue={profile.protectionStatus} /></Field>
            <Field label={t.c7.filterLanguage}><Select name="language" options={langOptions} defaultValue={profile.language ?? ""} /></Field>
            <div className="sm:col-span-2"><PrimaryButton type="submit">{t.c7.save}</PrimaryButton></div>
          </form>
        </Card>
      )}
      {canManage && archived && (
        <Card>
          <SectionHeader title={t.profiles.archived} />
          <p className="mb-3 text-sm text-[var(--color-muted)]">{t.dialog.restoreProfileBody}</p>
          <ConfirmDialog action={restoreProtectedProfileAction} hiddenName="profileId" hiddenValue={profile.id} triggerLabel={t.c7.restore} triggerClassName="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]" title={t.dialog.restoreProfileTitle} body={t.dialog.restoreProfileBody} confirmLabel={t.dialog.restoreProfileConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={t.actionErrors} />
        </Card>
      )}

      {/* CS-C7 — guardian management */}
      <Card>
        <SectionHeader title={t.c7.guardiansTitle} />
        {rels.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.c7.noGuardians}</p> : (
          <ul className="divide-y divide-[var(--color-border)]">
            {rels.map((r) => {
              const life = guardianLifecycleState(r);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.guardianRole === "primary" ? "brand" : "neutral"}>{famLabel(t.c7.roles, r.guardianRole)}</Badge>
                    <Badge tone={life === "active" ? "ok" : "neutral"}>{famLabel(t.c7.lifecycle, life)}</Badge>
                    <span className="text-xs text-[var(--color-muted)]">{famLabel(t.labels.relationshipType, r.relationshipType)} · {famLabel(t.c7.authority, r.authorityLevel)}</span>
                  </div>
                  {canGuardian && life === "active" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <form method="post" action={updateGuardianRoleAction} className="flex items-center gap-1">
                        <input type="hidden" name="profileId" value={profile.id} />
                        <input type="hidden" name="relationshipId" value={r.id} />
                        <Select name="guardianRole" options={roleOptions} defaultValue={r.guardianRole} />
                        <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">{t.c7.changeRole}</button>
                      </form>
                      <ConfirmDialog action={deactivateGuardianRelationshipAction} hiddenName="relationshipId" hiddenValue={r.id} triggerLabel={t.c7.deactivate} title={t.dialog.deactivateGuardianTitle} body={t.dialog.deactivateGuardianBody} confirmLabel={t.dialog.deactivateGuardianConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={t.actionErrors} danger />
                    </div>
                  ) : canGuardian && r.status === "suspended" ? (
                    <form method="post" action={reactivateGuardianRelationshipAction}>
                      <input type="hidden" name="profileId" value={profile.id} />
                      <input type="hidden" name="relationshipId" value={r.id} />
                      <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-brand-strong)] hover:border-[var(--color-brand)]">{t.c7.reactivate}</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {canGuardian && !archived && (
          <form action={createGuardianRelationshipAction} className="mt-5 grid gap-3 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2">
            <input type="hidden" name="protectedProfileId" value={profile.id} />
            <Field label={t.c7.guardianMember}>
              <Select name="guardianMembershipId" required options={members.map((m) => ({ value: m.membershipId, label: m.label }))} />
            </Field>
            <Field label={t.c7.relationshipLabel}>
              <Select name="relationshipType" required defaultValue={GuardianRelationshipType.Parent} options={Object.values(GuardianRelationshipType).map((v) => ({ value: v, label: famLabel(t.labels.relationshipType, v) }))} />
            </Field>
            <Field label={t.c7.authorityLabel}>
              <Select name="authorityLevel" required defaultValue={GuardianAuthorityLevel.ReadOnly} options={Object.values(GuardianAuthorityLevel).map((v) => ({ value: v, label: famLabel(t.c7.authority, v) }))} />
            </Field>
            <Field label={t.c7.roleLabel}>
              <Select name="guardianRole" required defaultValue="secondary" options={roleOptions} />
            </Field>
            <div className="sm:col-span-2 flex items-center gap-3">
              <PrimaryButton type="submit">{t.c7.addGuardian}</PrimaryButton>
              <span className="text-xs text-[var(--color-muted)]">{t.c7.guardianAddHint}</span>
            </div>
          </form>
        )}
      </Card>

      {/* CS-C9 — guardian authority lifecycle (grant/change/suspend/resume/revoke) per active guardian */}
      {activeGuardians.length > 0 && (
        <Card>
          <SectionHeader title={t.c9.title} />
          <p className="mb-3 text-xs text-[var(--color-muted)]">{t.c9.disclaimer}</p>
          <div className="space-y-3">
            {authorityData.map((a) => (
              <GuardianAuthoritySection key={a.rel.id} t={t} profileId={profile.id} relationshipId={a.rel.id} guardianRoleLabel={famLabel(t.c7.roles, a.rel.guardianRole)} records={a.records} effective={a.effective} timeline={a.timeline} canManage={canManageAuthority} />
            ))}
          </div>
        </Card>
      )}

      {/* CS-C10 — consent lifecycle (grant/suspend/resume/revoke) per active guardian */}
      {activeGuardians.length > 0 && (
        <Card>
          <SectionHeader title={t.c10.title} />
          <p className="mb-3 text-xs text-[var(--color-muted)]">{t.c10.disclaimer}</p>
          <div className="space-y-3">
            {consentData.map((a) => (
              <GuardianConsentSection key={a.rel.id} t={t} profileId={profile.id} relationshipId={a.rel.id} guardianRoleLabel={famLabel(t.c7.roles, a.rel.guardianRole)} records={a.records} effective={a.effective} timeline={a.timeline} canManage={canManageConsent} />
            ))}
          </div>
        </Card>
      )}

      {/* CS-C7 — content-free append-only timeline */}
      <Card>
        <SectionHeader title={t.c7.timelineTitle} />
        {timeline.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.c7.timelineEmpty}</p> : (
          <ol className="space-y-2.5">
            {timeline.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand)]" />
                  <span>{t.c7.events[e.event] ?? e.event.split(".").slice(-1)[0]?.replace(/_/g, " ")}</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--color-muted)]">{new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <SectionHeader title={t.profiles.detailTabs.consent} />
        {consents.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.guardians.incomplete}</p> : (
          <ul className="divide-y divide-[var(--color-border)]">
            {consents.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span>{t.guardians.consent}</span>
                <Badge tone={c.consentStatus === "active" ? "ok" : "neutral"}>{famLabel(t.labels.consentStatus, c.consentStatus)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeader title={t.profiles.detailTabs.signals} action={<Link href="/family/signals" className="text-xs font-medium text-[var(--color-brand-strong)]">{t.common.view}</Link>} />
        {signals.items.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.signals.emptyText}</p> : (
          <ul className="divide-y divide-[var(--color-border)]">
            {signals.items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex items-center gap-2"><Badge tone="neutral">{famLabel(t.labels.signalType, s.signalType)}</Badge><span className="text-xs text-[var(--color-muted)]">{famLabel(t.labels.severity, s.severity)}</span></span>
                <span className="text-xs text-[var(--color-muted)]">{fmt(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-[var(--color-muted)]">{t.signals.disclaimer}</p>
      </Card>
    </div>
  );
}
