import Link from "next/link";
import { searchProtectedProfiles } from "@guardora/db";
import { INVITABLE_FAMILY_ROLES, ALL_GUARDIAN_ROLES, GuardianRelationshipType, FamilyAction } from "@guardora/core";
import { requireFamilyConsole, familyCan } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../../family-i18n";
import { FamilyNoticeCard } from "../../../family-ui";
import { CreateInvitationForm } from "../create-form";

export const dynamic = "force-dynamic";

export default async function NewInvitationPage() {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  if (!familyCan(actor, FamilyAction.FamilyInvitationCreate)) {
    return <div className="mx-auto max-w-3xl space-y-6"><PageHeader title={t.c8.newTitle} /><FamilyNoticeCard title={t.empty.noticeTitle} body={t.common.notAvailable} /></div>;
  }
  const profiles = await searchProtectedProfiles(actor, { state: "active" });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t.c8.newTitle} description={t.c8.subtitle} action={<Link href="/family/invitations" className="text-sm text-[var(--color-brand-strong)]">← {t.c8.back}</Link>} />
      <Card>
        <CreateInvitationForm
          profiles={profiles.map((p) => ({ value: p.id, label: p.guardianLabel ?? famLabel(t.labels.ageBand, p.ageBand) }))}
          familyRoles={(INVITABLE_FAMILY_ROLES as readonly string[]).map((v) => ({ value: v, label: famLabel(t.c8.familyRoles, v) }))}
          guardianRoles={(ALL_GUARDIAN_ROLES as readonly string[]).map((v) => ({ value: v, label: famLabel(t.c7.roles, v) }))}
          relationshipTypes={Object.values(GuardianRelationshipType).map((v) => ({ value: v, label: famLabel(t.labels.relationshipType, v) }))}
          errorMessages={t.c8.errors}
          strings={{
            invitedEmail: t.c8.invitedEmail, emailHint: t.c8.emailHint, familyRoleLabel: t.c8.familyRoleLabel, guardianRoleLabel: t.c8.guardianRoleLabel,
            relationshipLabel: t.c8.relationshipLabel, submit: t.c8.submit, linkTitle: t.c8.linkTitle, linkWarning: t.c8.linkWarning, copyLink: t.c8.copyLink,
            copied: t.c8.copied, copyAria: t.c8.copyAria, linkGoneHint: t.c8.linkGoneHint, back: t.c8.back, errorTitle: t.dialog.errorTitle, profileLabel: t.c8.profileCol,
          }}
        />
      </Card>
    </div>
  );
}
