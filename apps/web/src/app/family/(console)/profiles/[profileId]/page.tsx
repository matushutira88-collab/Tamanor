import Link from "next/link";
import { notFound } from "next/navigation";
import { getProtectedProfile, listRelationshipsForProfile, listConsentRecords, listSafetySignals, FamilyNotFoundError } from "@guardora/db";
import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../../family-i18n";

export const dynamic = "force-dynamic";
function fmt(d: Date | null): string { return d ? new Date(d).toISOString().slice(0, 10) : "—"; }

export default async function ProfileDetailPage({ params }: { params: Promise<{ profileId: string }> }) {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const { profileId } = await params;

  let profile;
  try { profile = await getProtectedProfile(actor, profileId); }
  catch (e) { if (e instanceof FamilyNotFoundError) notFound(); throw e; }

  const [rels, consents, signals] = await Promise.all([
    listRelationshipsForProfile(actor, profileId, { includeInactive: true }),
    listConsentRecords(actor, profileId, { includeInactive: true }),
    listSafetySignals(actor, { protectedProfileId: profileId, includeArchived: true, limit: 20 }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={profile.guardianLabel ?? famLabel(t.labels.ageBand, profile.ageBand)}
        description={`${famLabel(t.labels.ageBand, profile.ageBand)} · ${profile.archivedAt ? t.profiles.archived : famLabel(t.labels.protectionStatus, profile.protectionStatus)}`}
        action={<Link href="/family/profiles" className="text-sm text-[var(--color-brand-strong)]">← {t.profiles.title}</Link>}
      />

      <Card>
        <SectionHeader title={t.profiles.detailTabs.guardians} />
        {rels.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t.guardians.incomplete}</p> : (
          <ul className="divide-y divide-[var(--color-border)]">
            {rels.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <Badge tone="neutral">{famLabel(t.labels.relationshipType, r.relationshipType)}</Badge>
                <Badge tone={r.status === "verified" ? "ok" : "warn"}>{famLabel(t.labels.relationshipStatus, r.status)}</Badge>
                <span className="text-xs text-[var(--color-muted)]">{t.guardians.eligibility}: {famLabel(t.labels.eligibility, r.safeRecipientEligibility)}</span>
              </li>
            ))}
          </ul>
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
