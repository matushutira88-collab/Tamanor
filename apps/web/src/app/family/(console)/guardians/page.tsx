import { listProtectedProfiles, listRelationshipsForProfile, getEffectiveGuardianAuthority, getEffectiveConsent, getEffectiveSafeRecipientEligibility } from "@guardora/db";
import { ConsentType } from "@guardora/core";
import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../family-i18n";

export const dynamic = "force-dynamic";

function Stage({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "neutral" }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

export default async function FamilyGuardiansPage() {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const profiles = await listProtectedProfiles(actor);

  const rows: { profileLabel: string; relId: string; relType: string; relStatus: string; authority: string; consent: string; assessment: string; eligibility: string }[] = [];
  for (const p of profiles) {
    const rels = await listRelationshipsForProfile(actor, p.id, { includeInactive: false });
    for (const r of rels) {
      const [auth, consent, assess] = await Promise.all([
        getEffectiveGuardianAuthority(actor, r.id),
        getEffectiveConsent(actor, p.id, ConsentType.Guardian),
        getEffectiveSafeRecipientEligibility(actor, r.id),
      ]);
      rows.push({
        profileLabel: p.guardianLabel ?? famLabel(t.labels.ageBand, p.ageBand),
        relId: r.id, relType: r.relationshipType, relStatus: r.status,
        authority: auth ? "verified" : "none", consent: consent ? "active" : "none",
        assessment: assess ? "approved" : "none", eligibility: assess ? "eligible" : "not_verified",
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t.guardians.title} description={t.guardians.intro} />
      <Card>
        <SectionHeader title={t.guardians.title} />
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{t.guardians.incomplete}</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.relId} className="rounded-lg border border-[var(--color-border)] p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">{row.profileLabel} · {famLabel(t.labels.relationshipType, row.relType)}</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Stage label={t.guardians.relationship} value={famLabel(t.labels.relationshipStatus, row.relStatus)} tone={row.relStatus === "verified" ? "ok" : "warn"} />
                  <Stage label={t.guardians.authority} value={famLabel(t.labels.authorityStatus, row.authority)} tone={row.authority === "verified" ? "ok" : "neutral"} />
                  <Stage label={t.guardians.consent} value={famLabel(t.labels.consentStatus, row.consent)} tone={row.consent === "active" ? "ok" : "neutral"} />
                  <Stage label={t.guardians.assessment} value={famLabel(t.labels.assessmentStatus, row.assessment)} tone={row.assessment === "approved" ? "ok" : "neutral"} />
                  <Stage label={t.guardians.eligibility} value={famLabel(t.labels.eligibility, row.eligibility)} tone={row.eligibility === "eligible" ? "ok" : "neutral"} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
