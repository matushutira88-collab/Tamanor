import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge } from "@/components/dashboard/ui";
import { familyDict } from "../../family-i18n";

export const dynamic = "force-dynamic";

export default async function FamilySettingsPage() {
  const { session } = await requireFamilyConsole();
  const t = familyDict(await getLocale());

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2.5 text-sm last:border-0">
      <span className="text-[var(--color-muted)]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t.settings.title} />
      <Card>
        <SectionHeader title={t.brand} />
        <Row label={t.settings.workspaceName} value={session.tenantName} />
        <Row label={t.settings.workspaceTypeRO} value={<Badge tone="brand">{t.brand}</Badge>} />
        <Row label={t.settings.primaryGuardian} value={session.userName} />
      </Card>
      <Card>
        <SectionHeader title={t.settings.limits} />
        <ul className="space-y-2 text-sm text-[var(--color-muted)]">
          <li>{t.privacy.messages}</li>
          <li>{t.privacy.signal}</li>
          <li>{t.privacy.delivery}</li>
          <li>{t.privacy.integrations}</li>
        </ul>
      </Card>
    </div>
  );
}
