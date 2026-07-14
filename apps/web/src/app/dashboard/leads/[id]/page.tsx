import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadStatus, platformGetLeadById, platformRoleSatisfies } from "@guardora/db";
import { PageHeader, Card, SectionHeader, Badge, Textarea, PrimaryButton } from "@/components/dashboard/ui";
import { Notice } from "@/components/dashboard/notice";
import { LeadEraseZone } from "@/components/dashboard/lead-erase";
import { requirePlatformCapabilityOrNotFound } from "@/server/platform-auth";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { humanize, formatDateTime } from "@/lib/format";
import { updateLeadStatus, saveLeadNotes } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = { new: "brand", contacted: "warn", closed: "neutral" };

const COPY: Record<Locale, {
  backToLeads: string;
  detailsTitle: string;
  labelEmail: string;
  labelCompany: string;
  labelWebsite: string;
  labelSource: string;
  labelPlatforms: string;
  labelConsent: string;
  labelReceived: string;
  consentGiven: string;
  consentNo: string;
  messageLabel: string;
  statusTitle: string;
  statusDesc: string;
  status: Record<string, string>;
  source: Record<string, string>;
  noEmails: string;
  notesTitle: string;
  notesDesc: string;
  notesPlaceholder: string;
  saveNotes: string;
  erase: { heading: string; description: string; confirmLabel: string; confirmWord: string; ackLabel: string; button: string };
}> = {
  en: {
    backToLeads: "← All leads",
    detailsTitle: "Details",
    labelEmail: "Email",
    labelCompany: "Company",
    labelWebsite: "Website",
    labelSource: "Source",
    labelPlatforms: "Platforms",
    labelConsent: "Consent",
    labelReceived: "Received",
    consentGiven: "Given",
    consentNo: "No",
    messageLabel: "Message",
    statusTitle: "Status",
    statusDesc: "Track your outreach.",
    status: { new: "New", contacted: "Contacted", closed: "Closed" },
    source: { book_demo: "Book Demo", contact: "Contact" },
    noEmails: "No emails are sent from Tamanor — reach out from your own inbox.",
    notesTitle: "Internal notes",
    notesDesc: "Visible to your team only.",
    notesPlaceholder: "Add context, next steps…",
    saveNotes: "Save notes",
    erase: {
      heading: "Danger zone — erase this lead",
      description: "Permanently delete this lead and all of its data (name, email, company, message, notes). This is irreversible and cannot be undone.",
      confirmLabel: "Type ERASE to confirm",
      confirmWord: "ERASE",
      ackLabel: "I understand this permanently deletes this lead.",
      button: "Erase lead permanently",
    },
  },
  sk: {
    backToLeads: "← Všetky leady",
    detailsTitle: "Podrobnosti",
    labelEmail: "E-mail",
    labelCompany: "Spoločnosť",
    labelWebsite: "Webová stránka",
    labelSource: "Zdroj",
    labelPlatforms: "Platformy",
    labelConsent: "Súhlas",
    labelReceived: "Prijaté",
    consentGiven: "Udelený",
    consentNo: "Nie",
    messageLabel: "Správa",
    statusTitle: "Stav",
    statusDesc: "Sledujte priebeh oslovenia.",
    status: { new: "Nový", contacted: "Kontaktovaný", closed: "Uzavretý" },
    source: { book_demo: "Žiadosť o demo", contact: "Kontakt" },
    noEmails: "Tamanor neodosiela žiadne e-maily — ozvite sa z vlastnej schránky.",
    notesTitle: "Interné poznámky",
    notesDesc: "Viditeľné len pre váš tím.",
    notesPlaceholder: "Pridajte kontext, ďalšie kroky…",
    saveNotes: "Uložiť poznámky",
    erase: {
      heading: "Nebezpečná zóna — vymazať tento lead",
      description: "Natrvalo odstrániť tento lead a všetky jeho údaje (meno, e-mail, spoločnosť, správa, poznámky). Túto akciu nie je možné vrátiť späť.",
      confirmLabel: "Pre potvrdenie napíšte ERASE",
      confirmWord: "ERASE",
      ackLabel: "Rozumiem, že sa tým natrvalo odstráni tento lead.",
      button: "Natrvalo vymazať lead",
    },
  },
  de: {
    backToLeads: "← Alle Leads",
    detailsTitle: "Details",
    labelEmail: "E-Mail",
    labelCompany: "Unternehmen",
    labelWebsite: "Website",
    labelSource: "Quelle",
    labelPlatforms: "Plattformen",
    labelConsent: "Einwilligung",
    labelReceived: "Empfangen",
    consentGiven: "Erteilt",
    consentNo: "Nein",
    messageLabel: "Nachricht",
    statusTitle: "Status",
    statusDesc: "Verfolgen Sie Ihre Kontaktaufnahme.",
    status: { new: "Neu", contacted: "Kontaktiert", closed: "Geschlossen" },
    source: { book_demo: "Demo-Anfrage", contact: "Kontakt" },
    noEmails: "Von Tamanor werden keine E-Mails versendet — melden Sie sich aus Ihrem eigenen Postfach.",
    notesTitle: "Interne Notizen",
    notesDesc: "Nur für Ihr Team sichtbar.",
    notesPlaceholder: "Kontext, nächste Schritte hinzufügen…",
    saveNotes: "Notizen speichern",
    erase: {
      heading: "Gefahrenzone — diesen Lead löschen",
      description: "Diesen Lead und alle seine Daten (Name, E-Mail, Unternehmen, Nachricht, Notizen) dauerhaft löschen. Dies ist unwiderruflich.",
      confirmLabel: "Geben Sie zur Bestätigung ERASE ein",
      confirmWord: "ERASE",
      ackLabel: "Mir ist bewusst, dass dies diesen Lead dauerhaft löscht.",
      button: "Lead dauerhaft löschen",
    },
  },
};

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Platform boundary FIRST — unauthenticated / ordinary tenant users get a uniform 404 (does not
  // reveal the lead exists), before any lead query runs.
  const { userId, platformRole } = await requirePlatformCapabilityOrNotFound("leads:read");
  // V1.45C3 — the erase control is Platform-Admin-only. Staff (leads:read/write) view/edit but never
  // see or invoke erasure. Server authorization is authoritative (eraseLeads re-checks leads:erase).
  const canErase = platformRoleSatisfies(platformRole, "leads:erase");

  const lead = await platformGetLeadById(userId, id);
  if (!lead) notFound();

  const locale = await getLocale();
  const c = COPY[locale];

  return (
    <>
      <PageHeader
        title={lead.name}
        description={lead.email}
        action={<Badge tone={STATUS_TONE[lead.status] ?? "neutral"}>{c.status[lead.status] ?? humanize(lead.status)}</Badge>}
      />
      <Link href="/dashboard/leads" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">{c.backToLeads}</Link>
      <div className="mt-4">
        <Notice notice={sp.notice} kind={sp.kind} />
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionHeader title={c.detailsTitle} />
          <dl className="space-y-2.5 text-sm">
            <Row label={c.labelEmail}><a className="text-[var(--color-brand)] hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></Row>
            <Row label={c.labelCompany}>{lead.company ?? "—"}</Row>
            <Row label={c.labelWebsite}>{lead.website ? <a className="text-[var(--color-brand)] hover:underline" href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a> : "—"}</Row>
            <Row label={c.labelSource}>{c.source[lead.source] ?? humanize(lead.source)}</Row>
            <Row label={c.labelPlatforms}>{lead.platforms.length ? lead.platforms.join(", ") : "—"}</Row>
            <Row label={c.labelConsent}>{lead.consent ? <Badge tone="ok">{c.consentGiven}</Badge> : <Badge tone="warn">{c.consentNo}</Badge>}</Row>
            <Row label={c.labelReceived}>{formatDateTime(lead.createdAt)}</Row>
          </dl>
          {lead.message ? (
            <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <p className="mb-1 text-xs font-medium text-[var(--color-muted)]">{c.messageLabel}</p>
              <p className="text-sm leading-relaxed">{lead.message}</p>
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionHeader title={c.statusTitle} description={c.statusDesc} />
            <div className="flex flex-wrap gap-2">
              {Object.values(LeadStatus).map((s) => (
                <form key={s} action={updateLeadStatus.bind(null, lead.id, s)}>
                  <button
                    type="submit"
                    disabled={lead.status === s}
                    className="rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-xs transition hover:border-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {c.status[s] ?? humanize(s)}
                  </button>
                </form>
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              {c.noEmails}
            </p>
          </Card>

          <Card>
            <SectionHeader title={c.notesTitle} description={c.notesDesc} />
            <form action={saveLeadNotes.bind(null, lead.id)} className="space-y-3">
              <Textarea name="notes" rows={5} defaultValue={lead.notes ?? ""} placeholder={c.notesPlaceholder} />
              <PrimaryButton type="submit">{c.saveNotes}</PrimaryButton>
            </form>
          </Card>

          {canErase ? <LeadEraseZone leadId={lead.id} copy={c.erase} /> : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="max-w-[60%] truncate text-right">{children}</dd>
    </div>
  );
}
