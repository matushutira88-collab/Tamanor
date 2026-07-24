import Link from "next/link";
import { listFamilyGuardianInvitations, getFamilyInvitationCounts, searchProtectedProfiles, FamilyForbiddenError } from "@guardora/db";
import { ALL_GUARDIAN_ROLES, ALL_FAMILY_INVITATION_STATUSES, FamilyAction } from "@guardora/core";
import { requireFamilyConsole, familyCan } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge, StatCard, Field, Input, Select, PrimaryButton } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../family-i18n";
import { FamilyEmptyState, FamilyNoticeCard, FamilyStatusBanner } from "../../family-ui";
import { ConfirmDialog } from "../../confirm-dialog";
import { revokeFamilyGuardianInvitationAction } from "./actions";

export const dynamic = "force-dynamic";
function fmt(d: Date | null): string { return d ? new Date(d).toISOString().slice(0, 10) : "—"; }
type SP = { status?: string; guardianRole?: string; profileId?: string; q?: string; ok?: string; e?: string };
const statusTone = (s: string) => (s === "accepted" ? "ok" : s === "pending" ? "brand" : s === "revoked" || s === "expired" ? "neutral" : "warn");

export default async function FamilyInvitationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const sp = await searchParams;
  if (!familyCan(actor, FamilyAction.FamilyInvitationView)) {
    return <div className="space-y-6"><PageHeader title={t.c8.title} /><FamilyNoticeCard title={t.empty.noticeTitle} body={t.common.notAvailable} /></div>;
  }
  const canManage = familyCan(actor, FamilyAction.FamilyInvitationCreate);
  const canRevoke = familyCan(actor, FamilyAction.FamilyInvitationRevoke);

  const filters = {
    status: (ALL_FAMILY_INVITATION_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined,
    guardianRole: (ALL_GUARDIAN_ROLES as readonly string[]).includes(sp.guardianRole ?? "") ? sp.guardianRole : undefined,
    protectedProfileId: sp.profileId || undefined,
    query: sp.q?.trim() || undefined,
  };
  let counts, invitations, profiles;
  try {
    [counts, invitations, profiles] = await Promise.all([
      getFamilyInvitationCounts(actor),
      listFamilyGuardianInvitations(actor, filters),
      searchProtectedProfiles(actor, { state: "all" }),
    ]);
  } catch (e) { if (e instanceof FamilyForbiddenError) return <div className="space-y-6"><PageHeader title={t.c8.title} /><FamilyNoticeCard title={t.empty.noticeTitle} body={t.common.notAvailable} /></div>; throw e; }

  const profileLabel = (id: string) => { const p = profiles.find((x) => x.id === id); return p ? (p.guardianLabel ?? famLabel(t.labels.ageBand, p.ageBand)) : "—"; };
  const anyOpt = { value: "", label: t.c8.anyOption };
  const banner = sp.ok ? { tone: "ok" as const, msg: t.c8.statuses.revoked } : sp.e ? { tone: "danger" as const, msg: t.c8.errors[sp.e] ?? t.c8.errors.retry_later } : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t.c8.title} description={t.c8.subtitle} action={canManage ? <Link href="/family/invitations/new" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{t.c8.create}</Link> : undefined} />
      {banner?.tone === "danger" ? <FamilyStatusBanner tone="danger" message={banner.msg} /> : null}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label={famLabel(t.c8.statuses, "pending")} value={String(counts.pending)} tone="brand" />
        <StatCard label={famLabel(t.c8.statuses, "accepted")} value={String(counts.accepted)} tone="ok" />
        <StatCard label={famLabel(t.c8.statuses, "declined")} value={String(counts.declined)} />
        <StatCard label={famLabel(t.c8.statuses, "revoked")} value={String(counts.revoked)} />
        <StatCard label={famLabel(t.c8.statuses, "expired")} value={String(counts.expired)} />
      </div>

      <Card>
        <SectionHeader title={t.c8.filterStatus} />
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 sm:items-end">
          <Field label={t.c8.searchEmail}><Input name="q" defaultValue={sp.q ?? ""} placeholder={t.c8.searchEmail} /></Field>
          <Field label={t.c8.filterStatus}><Select name="status" defaultValue={filters.status ?? ""} options={[anyOpt, ...(ALL_FAMILY_INVITATION_STATUSES as readonly string[]).map((v) => ({ value: v, label: famLabel(t.c8.statuses, v) }))]} /></Field>
          <Field label={t.c8.filterRole}><Select name="guardianRole" defaultValue={filters.guardianRole ?? ""} options={[anyOpt, ...(ALL_GUARDIAN_ROLES as readonly string[]).map((v) => ({ value: v, label: famLabel(t.c7.roles, v) }))]} /></Field>
          <Field label={t.c8.profileCol}><Select name="profileId" defaultValue={filters.protectedProfileId ?? ""} options={[anyOpt, ...profiles.map((p) => ({ value: p.id, label: p.guardianLabel ?? famLabel(t.labels.ageBand, p.ageBand) }))]} /></Field>
          <div className="flex gap-2">
            <PrimaryButton type="submit">{t.c8.apply}</PrimaryButton>
            <Link href="/family/invitations" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-fg)]">{t.c8.clear}</Link>
          </div>
        </form>
      </Card>

      <Card>
        <SectionHeader title={t.c8.title} />
        {invitations.length === 0 ? (
          <FamilyEmptyState
            illustration="invitations"
            title={t.empty.invitationsTitle}
            body={t.empty.invitationsBody}
            primary={{ href: "/family/invitations/new", label: t.empty.invitationsCta }}
            secondary={{ href: "/family/guardians", label: t.empty.invitationsSecondary }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3 font-medium">{t.c8.invitedEmailCol}</th>
                  <th className="py-2 pr-3 font-medium">{t.c8.profileCol}</th>
                  <th className="py-2 pr-3 font-medium">{t.c8.roleCol}</th>
                  <th className="py-2 pr-3 font-medium">{t.c8.statusCol}</th>
                  <th className="py-2 pr-3 font-medium">{t.c8.expiresCol}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--color-border)]">
                    <td className="py-2.5 pr-3">{inv.invitedEmailNormalized}</td>
                    <td className="py-2.5 pr-3">{profileLabel(inv.protectedProfileId)}</td>
                    <td className="py-2.5 pr-3"><span className="flex flex-wrap items-center gap-1"><Badge tone={inv.intendedGuardianRole === "primary" ? "brand" : "neutral"}>{famLabel(t.c7.roles, inv.intendedGuardianRole)}</Badge><span className="text-xs text-[var(--color-muted)]">{famLabel(t.c8.familyRoles, inv.intendedFamilyRole)}</span></span></td>
                    <td className="py-2.5 pr-3"><Badge tone={statusTone(inv.status)}>{famLabel(t.c8.statuses, inv.status)}</Badge></td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--color-muted)]">{fmt(inv.expiresAt)}</td>
                    <td className="py-2.5 text-right">
                      {canRevoke && inv.status === "pending" ? (
                        <ConfirmDialog action={revokeFamilyGuardianInvitationAction} hiddenName="invitationId" hiddenValue={inv.id} triggerLabel={t.c8.revoke} title={t.c8.revokeDialogTitle} body={t.c8.revokeDialogBody} confirmLabel={t.c8.revokeDialogConfirm} cancelLabel={t.dialog.cancel} workingLabel={t.dialog.working} errorTitle={t.dialog.errorTitle} errorMessages={t.c8.errors} danger />
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
