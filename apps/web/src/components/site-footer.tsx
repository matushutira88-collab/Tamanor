import Link from "next/link";
import { getDictionary, defaultLocale, localePrefix, type Dictionary, type Locale } from "@/i18n";

// Tamanor EU Compliance Pack — localized links to the full legal/compliance library.
// Kept as a local label map so the large i18n dictionaries stay untouched.
const COMPLIANCE_LINKS: Record<Locale, { label: string; href: string }[]> = {
  en: [
    { label: "Data Processing Agreement", href: "/dpa" },
    { label: "Subprocessors", href: "/subprocessors" },
    { label: "AI transparency", href: "/ai-transparency" },
    { label: "Your data rights", href: "/data-subject-rights" },
    { label: "Data retention", href: "/data-retention" },
    { label: "International transfers", href: "/international-transfers" },
    { label: "Incident & breach", href: "/incident-policy" },
    { label: "Information security", href: "/information-security" },
    { label: "Security policy", href: "/security-policy" },
    { label: "Business terms (B2B)", href: "/business-terms" },
    { label: "Consumer terms (B2C)", href: "/consumer-terms" },
    { label: "Copyright & IP", href: "/copyright" },
  ],
  sk: [
    { label: "Zmluva o spracúvaní údajov (DPA)", href: "/dpa" },
    { label: "Subdodávatelia", href: "/subprocessors" },
    { label: "Transparentnosť AI", href: "/ai-transparency" },
    { label: "Práva dotknutých osôb", href: "/data-subject-rights" },
    { label: "Uchovávanie údajov", href: "/data-retention" },
    { label: "Medzinárodné prenosy", href: "/international-transfers" },
    { label: "Incidenty a porušenia", href: "/incident-policy" },
    { label: "Informačná bezpečnosť", href: "/information-security" },
    { label: "Bezpečnostné zásady", href: "/security-policy" },
    { label: "Podmienky pre firmy (B2B)", href: "/business-terms" },
    { label: "Spotrebiteľské podmienky (B2C)", href: "/consumer-terms" },
    { label: "Autorské práva a IP", href: "/copyright" },
  ],
  de: [
    { label: "Auftragsverarbeitung (AVV)", href: "/dpa" },
    { label: "Unterauftragsverarbeiter", href: "/subprocessors" },
    { label: "KI-Transparenz", href: "/ai-transparency" },
    { label: "Betroffenenrechte", href: "/data-subject-rights" },
    { label: "Datenaufbewahrung", href: "/data-retention" },
    { label: "Internationale Übermittlungen", href: "/international-transfers" },
    { label: "Sicherheitsvorfälle", href: "/incident-policy" },
    { label: "Informationssicherheit", href: "/information-security" },
    { label: "Sicherheitsrichtlinie", href: "/security-policy" },
    { label: "Geschäftskunden (B2B)", href: "/business-terms" },
    { label: "Verbraucher (B2C)", href: "/consumer-terms" },
    { label: "Urheberrecht & IP", href: "/copyright" },
  ],
};

export function SiteFooter({
  dict,
  locale = defaultLocale,
}: {
  dict?: Dictionary;
  locale?: Locale;
}) {
  const t = dict ?? getDictionary(locale);
  const lp = localePrefix(locale);

  type FooterLink = { label: string; href: string };
  // A platform column can carry status-labelled groups so the footer stays truthful:
  // the two live Meta providers are shown as available; the rest are visibly de-emphasised
  // and captioned "In development" — status is conveyed by a text caption + reduced
  // emphasis, never by colour alone, matching the homepage.
  const columns: { title: string; links?: FooterLink[]; groups?: { caption: string; muted?: boolean; links: FooterLink[] }[] }[] = [
    {
      title: t.footer.product,
      links: [
        { label: t.footer.inbox, href: "/login" },
        { label: t.footer.approvals, href: "/login" },
        { label: t.footer.insights, href: "/login" },
        { label: t.footer.reports, href: "/login" },
        { label: t.footer.auditLog, href: "/login" },
      ],
    },
    {
      title: t.footer.platforms,
      groups: [
        {
          caption: t.footer.available,
          links: [
            { label: "Facebook Pages", href: "/integrations/facebook" },
            { label: "Instagram Business", href: "/integrations/instagram" },
          ],
        },
        {
          caption: t.footer.inDevelopment,
          muted: true,
          links: [
            { label: "Google Business", href: "/integrations/google-business" },
            { label: "YouTube", href: "/integrations/youtube" },
            { label: "LinkedIn", href: "/integrations/linkedin" },
            { label: "TikTok", href: "/integrations/tiktok" },
          ],
        },
      ],
    },
    {
      // V1.38.2 — internal link graph into the new GEO/knowledge pages.
      title: "Learn",
      links: [
        { label: "Platform & architecture", href: "/platform" },
        { label: "Features", href: "/features" },
        { label: "Integrations", href: "/integrations" },
        { label: "Compare", href: "/compare" },
        { label: "Documentation", href: "/docs" },
        { label: "AI discoverability", href: "/ai" },
      ],
    },
    {
      title: t.footer.company,
      links: [
        { label: t.footer.about, href: "/about" },
        { label: t.nav.caseStudies, href: `${lp}/case-studies` },
        { label: t.footer.contact, href: "/contact" },
      ],
    },
    {
      title: t.footer.legal,
      links: [
        { label: t.footer.privacy, href: "/privacy" },
        { label: t.footer.cookies, href: "/cookies" },
        { label: t.footer.terms, href: "/terms" },
        { label: t.footer.security, href: "/security" },
        ...COMPLIANCE_LINKS[locale],
      ],
    },
  ];

  return (
    <footer className="border-t border-[var(--color-border)]">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(5,1fr)]">
          <div>
            <span className="text-lg font-semibold">Tamanor</span>
            <p className="mt-3 max-w-xs text-sm text-[var(--color-muted)]">{t.footer.tagline}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/register" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
                {t.common.startFree}
              </Link>
              <Link href="/login" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-xs font-semibold transition hover:bg-[var(--color-surface-2)]">
                {t.common.logIn}
              </Link>
            </div>
          </div>
          {columns.map((c) => (
            <div key={c.title}>
              <p className="text-sm font-semibold">{c.title}</p>
              {c.links ? (
                <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="transition hover:text-[var(--color-fg)]">{l.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {c.groups ? (
                <div className="mt-3 space-y-4">
                  {c.groups.map((g) => (
                    <div key={g.caption} className={g.muted ? "opacity-60" : undefined}>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">{g.caption}</p>
                      <ul className="mt-2 space-y-2 text-sm text-[var(--color-muted)]">
                        {g.links.map((l) => (
                          <li key={l.label}>
                            <Link href={l.href} className="transition hover:text-[var(--color-fg)]">{l.label}</Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-muted)] md:flex-row">
          <div className="flex flex-col items-center gap-0.5 md:items-start">
            <span>© {new Date().getFullYear()} Tamanor — {t.footer.rights}</span>
            {/* V1.54 — truthful operator identity + European Union framing (no invented geography). */}
            <span>Operated by Infotech Solutions, s. r. o. · {({ en: "European Union", sk: "Európska únia", de: "Europäische Union" } as const)[locale] ?? "European Union"}</span>
          </div>
          <span>{t.footer.badge}</span>
        </div>
      </div>
    </footer>
  );
}
