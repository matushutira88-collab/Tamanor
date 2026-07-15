import Link from "next/link";
import { LeadStatus, platformListLeads, platformGroupLeadsByStatus } from "@guardora/db";
import { PageHeader, Badge, EmptyState, Tabs, Card } from "@/components/dashboard/ui";
import { requirePlatformCapabilityOrNotFound } from "@/server/platform-auth";
import { navItem } from "@/lib/nav";
import { getTL } from "@/i18n/server";
import type { Locale } from "@/i18n";
import { humanize, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/leads");

const STATUS_TONE: Record<string, string> = {
  new: "brand",
  contacted: "warn",
  closed: "neutral",
};

const COPY: Record<Locale, {
  description: string;
  tabAll: string;
  status: Record<string, string>;
  source: Record<string, string>;
  emptyTitle: string;
  emptyBody: string;
  emptyHint: string;
  colName: string;
  colCompany: string;
  colSource: string;
  colStatus: string;
  colReceived: string;
  showing: (n: number) => string;
}> = {
  en: {
    description: "Platform-level prospect administration — demo requests and contact messages across the whole platform. Restricted to platform staff.",
    tabAll: "All",
    status: { new: "New", contacted: "Contacted", closed: "Closed" },
    source: { book_demo: "Book Demo", contact: "Contact" },
    emptyTitle: "No leads yet",
    emptyBody: "Sales enquiries and messages from /contact appear here as soon as they're submitted.",
    emptyHint: "Prospect submissions are stored platform-wide (not tenant-scoped) — no emails are sent.",
    colName: "Name",
    colCompany: "Company",
    colSource: "Source",
    colStatus: "Status",
    colReceived: "Received",
    showing: (n) => `Showing ${n} lead(s) · max 200.`,
  },
  sk: {
    description: "Správa potenciálnych zákazníkov na úrovni platformy — žiadosti o demo a kontaktné správy naprieč celou platformou. Prístup majú len pracovníci platformy.",
    tabAll: "Všetky",
    status: { new: "Nový", contacted: "Kontaktovaný", closed: "Uzavretý" },
    source: { book_demo: "Žiadosť o demo", contact: "Kontakt" },
    emptyTitle: "Zatiaľ žiadne leady",
    emptyBody: "Obchodné dopyty a správy z /contact sa tu zobrazia hneď po odoslaní.",
    emptyHint: "Odoslania potenciálnych zákazníkov sa ukladajú na úrovni celej platformy (nie sú viazané na nájomcu) — neodosielajú sa žiadne e-maily.",
    colName: "Meno",
    colCompany: "Spoločnosť",
    colSource: "Zdroj",
    colStatus: "Stav",
    colReceived: "Prijaté",
    showing: (n) => `Zobrazuje sa ${n} leadov · max 200.`,
  },
  de: {
    description: "Verwaltung von Interessenten auf Plattformebene — Demo-Anfragen und Kontaktnachrichten über die gesamte Plattform hinweg. Nur für Plattform-Mitarbeiter.",
    tabAll: "Alle",
    status: { new: "Neu", contacted: "Kontaktiert", closed: "Geschlossen" },
    source: { book_demo: "Demo-Anfrage", contact: "Kontakt" },
    emptyTitle: "Noch keine Leads",
    emptyBody: "Vertriebsanfragen und Nachrichten von /contact erscheinen hier, sobald sie übermittelt werden.",
    emptyHint: "Interessenten-Übermittlungen werden plattformweit gespeichert (nicht mandantenbezogen) — es werden keine E-Mails versendet.",
    colName: "Name",
    colCompany: "Unternehmen",
    colSource: "Quelle",
    colStatus: "Status",
    colReceived: "Empfangen",
    showing: (n) => `${n} Lead(s) angezeigt · max. 200.`,
  },
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Platform boundary FIRST — fail-closed 404 before any lead query runs. Ordinary tenant users
  // (incl. Owner/Admin) never reach the data below.
  const { userId } = await requirePlatformCapabilityOrNotFound("leads:read");
  const { t: hdrT, locale } = await getTL();
  const c = COPY[locale];

  const sp = await searchParams;
  const status =
    sp.status && (Object.values(LeadStatus) as string[]).includes(sp.status)
      ? (sp.status as LeadStatus)
      : undefined;

  // GLOBAL (cross-tenant) prospect table — read only via the platform-authorized service.
  const [groups, leads] = await Promise.all([
    platformGroupLeadsByStatus(userId),
    platformListLeads(userId, { where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  const count = new Map(groups.map((g) => [g.status, g._count as unknown as number]));
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  const tabs = [
    { key: "", label: c.tabAll, href: "/dashboard/leads", count: total },
    { key: LeadStatus.new, label: c.status[LeadStatus.new] ?? humanize(LeadStatus.new), href: `/dashboard/leads?status=${LeadStatus.new}`, count: count.get(LeadStatus.new) ?? 0 },
    { key: LeadStatus.contacted, label: c.status[LeadStatus.contacted] ?? humanize(LeadStatus.contacted), href: `/dashboard/leads?status=${LeadStatus.contacted}`, count: count.get(LeadStatus.contacted) ?? 0 },
    { key: LeadStatus.closed, label: c.status[LeadStatus.closed] ?? humanize(LeadStatus.closed), href: `/dashboard/leads?status=${LeadStatus.closed}`, count: count.get(LeadStatus.closed) ?? 0 },
  ];

  return (
    <>
      <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={c.description} />
      <Tabs active={status ?? ""} tabs={tabs} />

      {leads.length === 0 ? (
        <EmptyState
          title={c.emptyTitle}
          body={c.emptyBody}
          hint={c.emptyHint}
        />
      ) : (
        <Card className="!p-0">
          <div className="grid grid-cols-[1.4fr_1.1fr_0.8fr_0.8fr_0.9fr] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            <span>{c.colName}</span>
            <span>{c.colCompany}</span>
            <span>{c.colSource}</span>
            <span>{c.colStatus}</span>
            <span>{c.colReceived}</span>
          </div>
          {leads.map((l) => (
            <Link
              key={l.id}
              href={`/dashboard/leads/${l.id}`}
              className="grid grid-cols-[1.4fr_1.1fr_0.8fr_0.8fr_0.9fr] items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 text-sm transition last:border-0 hover:bg-[var(--color-surface-2)]"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="block truncate text-xs text-[var(--color-muted)]">{l.email}</span>
              </span>
              <span className="truncate text-[var(--color-muted)]">{l.company ?? "—"}</span>
              <span><Badge tone="neutral">{c.source[l.source] ?? humanize(l.source)}</Badge></span>
              <span><Badge tone={STATUS_TONE[l.status] ?? "neutral"}>{c.status[l.status] ?? humanize(l.status)}</Badge></span>
              <span className="text-xs text-[var(--color-muted)]">{formatDate(l.createdAt)}</span>
            </Link>
          ))}
        </Card>
      )}
      <p className="mt-3 text-xs text-[var(--color-muted)]">{c.showing(leads.length)}</p>
    </>
  );
}
