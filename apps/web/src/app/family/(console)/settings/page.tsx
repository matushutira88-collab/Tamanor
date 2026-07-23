import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge } from "@/components/dashboard/ui";
import { familyDict } from "../../family-i18n";

export const dynamic = "force-dynamic";

/**
 * CS-C6 / FAMILY-UI-01 — read-only Family settings. No mutations, no server actions:
 * every value here is rendered from the already-guarded session.
 */
export default async function FamilySettingsPage() {
  const { session } = await requireFamilyConsole();
  const t = familyDict(await getLocale());

  // Value-forward row: the label is quiet metadata, the value carries the weight.
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[var(--color-border)] py-3.5 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      <span className="min-w-0 text-base font-semibold text-[var(--color-fg)]">{value}</span>
    </div>
  );

  // One privacy/limitation statement per line, each with its own reading rhythm.
  const Statement = ({ children }: { children: React.ReactNode }) => (
    <li className="flex gap-3 border-b border-[var(--color-border)] py-3 text-sm leading-relaxed text-[var(--color-fg)] last:border-0">
      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand)]" />
      <span className="min-w-0">{children}</span>
    </li>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t.settings.title} description={t.settings.description} action={<Badge tone="brand">{t.brand}</Badge>} />

      <Card>
        <SectionHeader title={t.settings.spaceSection} description={t.settings.spaceDescription} action={<span className="text-xs text-[var(--color-muted)]">{t.settings.readOnlyHint}</span>} />
        <Row label={t.settings.workspaceName} value={session.tenantName} />
        <Row label={t.settings.workspaceTypeRO} value={<Badge tone="brand">{t.family}</Badge>} />
        <Row label={t.settings.primaryGuardian} value={session.userName} />
      </Card>

      <Card>
        <SectionHeader title={t.settings.privacySection} description={t.settings.privacyDescription} />
        <ul>
          <Statement>{t.privacy.messages}</Statement>
          <Statement>{t.privacy.signal}</Statement>
          <Statement>{t.privacy.delivery}</Statement>
        </ul>
      </Card>

      <Card>
        <SectionHeader title={t.settings.integrationsSection} description={t.settings.integrationsDescription} />
        <ul>
          <Statement>{t.privacy.integrations}</Statement>
          <Statement>{t.signals.emptyText}</Statement>
          <Statement>{t.deliveries.availableMeans}</Statement>
        </ul>
      </Card>
    </div>
  );
}
