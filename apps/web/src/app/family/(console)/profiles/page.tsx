import Link from "next/link";
import { searchProtectedProfiles, listRelationshipsForProfile } from "@guardora/db";
import { ALL_AGE_BANDS, ProtectionStatus, PROFILE_LANGUAGES, ALL_GUARDIAN_ROLES, FamilyAction } from "@guardora/core";
import { requireFamilyConsole, familyCan } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge, Field, Input, Select, PrimaryButton } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../family-i18n";
import { ConfirmDialog } from "../../confirm-dialog";
import { createProtectedProfileAction, archiveProtectedProfileAction, restoreProtectedProfileAction } from "./actions";

export const dynamic = "force-dynamic";
function fmt(d: Date): string { return new Date(d).toISOString().slice(0, 10); }
type SP = { q?: string; ageBand?: string; protectionStatus?: string; language?: string; state?: string; guardianRole?: string; ok?: string; e?: string };

export default async function FamilyProfilesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const sp = await searchParams;
  const canManage = familyCan(actor, FamilyAction.ProtectedProfileManage);

  const state = (sp.state === "archived" || sp.state === "all") ? sp.state : "active";
  const filters = {
    query: sp.q?.trim() || undefined,
    ageBand: (ALL_AGE_BANDS as readonly string[]).includes(sp.ageBand ?? "") ? sp.ageBand : undefined,
    protectionStatus: Object.values(ProtectionStatus).includes(sp.protectionStatus as ProtectionStatus) ? sp.protectionStatus : undefined,
    language: (PROFILE_LANGUAGES as readonly string[]).includes(sp.language ?? "") ? sp.language : undefined,
    guardianRole: (ALL_GUARDIAN_ROLES as readonly string[]).includes(sp.guardianRole ?? "") ? sp.guardianRole : undefined,
    state: state as "active" | "archived" | "all",
  };
  const profiles = await searchProtectedProfiles(actor, filters);
  const relCounts = await Promise.all(profiles.map((p) => listRelationshipsForProfile(actor, p.id).then((r) => r.length)));

  const ageOptions = (ALL_AGE_BANDS as readonly string[]).map((v) => ({ value: v, label: famLabel(t.labels.ageBand, v) }));
  const anyOpt = { value: "", label: t.c7.anyOption };
  const banner = sp.ok ? { tone: "ok" as const, msg: sp.ok === "restored" ? t.c7.restored : sp.ok } : sp.e ? { tone: "danger" as const, msg: t.actionErrors[sp.e] ?? t.actionErrors.retry_later } : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t.profiles.title} description={t.privacy.messages} />
      {banner ? <p role={banner.tone === "danger" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm border-[var(--color-${banner.tone})] bg-[var(--color-${banner.tone}-soft)] text-[var(--color-${banner.tone})]`}>{banner.msg}</p> : null}

      {canManage && (
        <Card>
          <SectionHeader title={t.profiles.create} />
          <p className="mb-3 text-xs text-[var(--color-muted)]">{t.c7.noPiiHint}</p>
          <form action={createProtectedProfileAction} className="grid gap-3 sm:grid-cols-[1.6fr_1fr_auto] sm:items-end">
            <Field label={t.profiles.label}><Input name="guardianLabel" maxLength={80} placeholder={t.profiles.newLabel} /></Field>
            <Field label={t.profiles.ageBand}><Select name="ageBand" options={ageOptions} required defaultValue="age_10_12" /></Field>
            <PrimaryButton type="submit">{t.onboarding.create}</PrimaryButton>
          </form>
        </Card>
      )}

      {/* CS-C7 — content-free search & filters (label, age, status, language, state, guardian role) */}
      <Card>
        <SectionHeader title={t.c7.searchTitle} />
        <form method="get" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 sm:items-end">
          <Field label={t.c7.searchPlaceholder}><Input name="q" defaultValue={sp.q ?? ""} placeholder={t.c7.searchPlaceholder} /></Field>
          <Field label={t.c7.filterAge}><Select name="ageBand" defaultValue={filters.ageBand ?? ""} options={[anyOpt, ...ageOptions]} /></Field>
          <Field label={t.c7.filterStatus}><Select name="protectionStatus" defaultValue={filters.protectionStatus ?? ""} options={[anyOpt, ...Object.values(ProtectionStatus).map((v) => ({ value: v, label: famLabel(t.labels.protectionStatus, v) }))]} /></Field>
          <Field label={t.c7.filterLanguage}><Select name="language" defaultValue={filters.language ?? ""} options={[anyOpt, ...(PROFILE_LANGUAGES as readonly string[]).map((v) => ({ value: v, label: v.toUpperCase() }))]} /></Field>
          <Field label={t.c7.filterRole}><Select name="guardianRole" defaultValue={filters.guardianRole ?? ""} options={[anyOpt, ...(ALL_GUARDIAN_ROLES as readonly string[]).map((v) => ({ value: v, label: famLabel(t.c7.roles, v) }))]} /></Field>
          <Field label={t.c7.filterState}><Select name="state" defaultValue={state} options={[{ value: "active", label: t.c7.stateActive }, { value: "archived", label: t.c7.stateArchived }, { value: "all", label: t.c7.stateAll }]} /></Field>
          <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
            <PrimaryButton type="submit">{t.c7.apply}</PrimaryButton>
            <Link href="/family/profiles" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-fg)]">{t.c7.clear}</Link>
          </div>
        </form>
      </Card>

      <Card>
        <SectionHeader title={t.profiles.title} />
        {profiles.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{t.profiles.emptyText}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3 font-medium">{t.profiles.label}</th>
                  <th className="py-2 pr-3 font-medium">{t.profiles.ageBand}</th>
                  <th className="py-2 pr-3 font-medium">{t.profiles.status}</th>
                  <th className="py-2 pr-3 font-medium">{t.c7.filterLanguage}</th>
                  <th className="py-2 pr-3 font-medium">{t.profiles.relationships}</th>
                  <th className="py-2 pr-3 font-medium">{t.profiles.created}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {profiles.map((p, i) => (
                  <tr key={p.id} className="border-b border-[var(--color-border)]">
                    <td className="py-2.5 pr-3"><Link href={`/family/profiles/${p.id}`} className="font-medium hover:underline">{p.guardianLabel ?? famLabel(t.labels.ageBand, p.ageBand)}</Link></td>
                    <td className="py-2.5 pr-3">{famLabel(t.labels.ageBand, p.ageBand)}</td>
                    <td className="py-2.5 pr-3"><Badge tone={p.archivedAt ? "neutral" : "ok"}>{p.archivedAt ? t.profiles.archived : famLabel(t.labels.protectionStatus, p.protectionStatus)}</Badge></td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--color-muted)]">{p.language ? p.language.toUpperCase() : t.c7.languageAuto}</td>
                    <td className="py-2.5 pr-3">{relCounts[i]}</td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--color-muted)]">{fmt(p.createdAt)}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/family/profiles/${p.id}`} className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">{t.c7.edit}</Link>
                        {canManage && !p.archivedAt ? (
                          <ConfirmDialog action={archiveProtectedProfileAction} hiddenName="profileId" hiddenValue={p.id} triggerLabel={t.profiles.archive} title={t.dialog.archiveProfileTitle} body={t.dialog.archiveProfileBody} confirmLabel={t.dialog.archiveProfileConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={t.actionErrors} danger />
                        ) : null}
                        {canManage && p.archivedAt ? (
                          <ConfirmDialog action={restoreProtectedProfileAction} hiddenName="profileId" hiddenValue={p.id} triggerLabel={t.c7.restore} title={t.dialog.restoreProfileTitle} body={t.dialog.restoreProfileBody} confirmLabel={t.dialog.restoreProfileConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={t.actionErrors} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
