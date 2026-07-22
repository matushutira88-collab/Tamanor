import Link from "next/link";
import { listProtectedProfiles, listRelationshipsForProfile } from "@guardora/db";
import { ALL_AGE_BANDS, FamilyAction } from "@guardora/core";
import { requireFamilyConsole, familyCan } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge, Field, Input, Select, PrimaryButton } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../family-i18n";
import { ConfirmDialog } from "../../confirm-dialog";
import { createProtectedProfileAction, archiveProtectedProfileAction } from "./actions";

export const dynamic = "force-dynamic";
function fmt(d: Date): string { return new Date(d).toISOString().slice(0, 10); }

export default async function FamilyProfilesPage() {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const canManage = familyCan(actor, FamilyAction.ProtectedProfileManage);
  const profiles = await listProtectedProfiles(actor, { includeArchived: true });
  const relCounts = await Promise.all(profiles.map((p) => listRelationshipsForProfile(actor, p.id).then((r) => r.length)));
  const ageOptions = (ALL_AGE_BANDS as readonly string[]).map((v) => ({ value: v, label: famLabel(t.labels.ageBand, v) }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t.profiles.title} description={t.privacy.messages} />

      {canManage && (
        <Card>
          <SectionHeader title={t.profiles.create} />
          <form action={createProtectedProfileAction} className="grid gap-3 sm:grid-cols-[1.6fr_1fr_auto] sm:items-end">
            <Field label={t.profiles.label}><Input name="guardianLabel" maxLength={80} placeholder={t.profiles.newLabel} /></Field>
            <Field label={t.profiles.ageBand}><Select name="ageBand" options={ageOptions} required defaultValue="age_10_12" /></Field>
            <PrimaryButton type="submit">{t.onboarding.create}</PrimaryButton>
          </form>
        </Card>
      )}

      <Card>
        <SectionHeader title={t.profiles.title} />
        {profiles.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{t.profiles.emptyText}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3 font-medium">{t.profiles.label}</th>
                  <th className="py-2 pr-3 font-medium">{t.profiles.ageBand}</th>
                  <th className="py-2 pr-3 font-medium">{t.profiles.status}</th>
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
                    <td className="py-2.5 pr-3">{relCounts[i]}</td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--color-muted)]">{fmt(p.createdAt)}</td>
                    <td className="py-2.5 text-right">
                      {canManage && !p.archivedAt ? (
                        <ConfirmDialog
                          action={archiveProtectedProfileAction}
                          hiddenName="profileId"
                          hiddenValue={p.id}
                          triggerLabel={t.profiles.archive}
                          title={t.dialog.archiveProfileTitle}
                          body={t.dialog.archiveProfileBody}
                          confirmLabel={t.dialog.archiveProfileConfirm}
                          cancelLabel={t.dialog.cancel}
                          workingLabel={t.dialog.working}
                          errorTitle={t.dialog.errorTitle}
                          errorMessages={t.actionErrors}
                          danger
                        />
                      ) : null}
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
