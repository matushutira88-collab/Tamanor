import Link from "next/link";
import type { Dictionary, Locale } from "@/i18n";

/**
 * V1.58D.2 — global public footer in the landing-v2 "mission control" visual language.
 * V1.58D.4 — localized: reuses the existing footer.* and common.* dictionary keys (no second footer
 * translation structure). Reusable, no client hooks (pure static markup — negligible hydration),
 * semantic <footer>/<nav>, focus-visible states, AA-contrast colours, motion-reduce safe.
 *
 * Truthful availability: the two live Meta providers are shown as available; the rest are visibly
 * de-emphasised and captioned "In development" — status by caption + reduced emphasis, never colour.
 */

const F = {
  bg: "#04100d",
  line: "#0f2b25",
  mint: "#2ee3b2",
  bright: "#eafff8",
  text: "#d9fff2",
  dim: "#6fa093",
};
const mono = "var(--font-mono-v2), ui-monospace, Menlo, monospace";
const sans = "var(--font-sans-v2), ui-sans-serif, system-ui, sans-serif";

const EU: Record<Locale, string> = { en: "European Union", sk: "Európska únia", de: "Europäische Union" };

// Tamanor EU Compliance Pack — localized links to the full legal/compliance library.
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

type L = { label: string; href: string };
const linkStyle: React.CSSProperties = { color: F.dim, textDecoration: "none", fontSize: 13, fontFamily: sans };

function Col({ title, links }: { title: string; links: L[] }) {
  return (
    <nav aria-label={title}>
      <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: F.mint, fontFamily: mono, margin: "0 0 12px" }}>{title}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="tmr-foot-link" style={linkStyle}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function FooterV2({
  footer,
  locale,
  startFree,
  logIn,
}: {
  footer: Dictionary["footer"];
  locale: Locale;
  startFree: string;
  logIn: string;
}) {
  const year = new Date().getFullYear();
  const product: L[] = [
    { label: footer.inbox, href: "/login" }, { label: footer.approvals, href: "/login" },
    { label: footer.insights, href: "/login" }, { label: footer.reports, href: "/login" }, { label: footer.auditLog, href: "/login" },
  ];
  // "Learn" links mirror the shipped SiteFooter (labels shared with the marketing IA).
  const learn: L[] = [
    { label: "Platform & architecture", href: "/platform" }, { label: "Features", href: "/features" },
    { label: "Integrations", href: "/integrations" }, { label: "Compare", href: "/compare" },
    { label: "Documentation", href: "/docs" }, { label: "AI discoverability", href: "/ai" },
  ];
  const company: L[] = [
    { label: footer.about, href: "/about" }, { label: footer.contact, href: "/contact" },
  ];
  const legal: L[] = [
    { label: footer.privacy, href: "/privacy" }, { label: footer.cookies, href: "/cookies" },
    { label: footer.terms, href: "/terms" }, { label: footer.security, href: "/security" },
    ...COMPLIANCE_LINKS[locale],
  ];
  const available: L[] = [
    { label: "Facebook Pages", href: "/integrations/facebook" }, { label: "Instagram Business", href: "/integrations/instagram" },
  ];
  const inDev: L[] = [
    { label: "Google Business", href: "/integrations/google-business" }, { label: "YouTube", href: "/integrations/youtube" },
    { label: "LinkedIn", href: "/integrations/linkedin" }, { label: "TikTok", href: "/integrations/tiktok" },
  ];

  return (
    <footer style={{ borderTop: `1px solid ${F.line}`, background: F.bg, position: "relative", zIndex: 1 }}>
      <style dangerouslySetInnerHTML={{ __html: `.tmr-foot-link{transition:color .15s}.tmr-foot-link:hover{color:${F.bright}}.tmr-foot-link:focus-visible{outline:2px solid ${F.mint};outline-offset:2px;border-radius:2px}@media (prefers-reduced-motion: reduce){.tmr-foot-link{transition:none}}` }} />
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "56px 24px 0" }}>
        <div style={{ display: "grid", gap: 40, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", alignItems: "start" }}>
          {/* Column 1 — Tamanor */}
          <div style={{ minWidth: 200 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: F.bright, fontFamily: "var(--font-disp-v2), ui-sans-serif, system-ui, sans-serif" }}>Tamanor</span>
            <p style={{ margin: "12px 0 18px", maxWidth: "34ch", fontSize: 13, lineHeight: 1.7, color: F.dim, fontFamily: sans }}>
              {footer.tagline}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Link href="/register" className="tmr-foot-link" style={{ background: F.mint, color: "#04140f", padding: "9px 16px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono, textDecoration: "none" }}>{startFree}</Link>
              <Link href="/login" className="tmr-foot-link" style={{ border: `1px solid ${F.line}`, color: F.text, padding: "9px 16px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono, textDecoration: "none" }}>{logIn}</Link>
            </div>
          </div>

          <Col title={footer.product} links={product} />

          {/* Platforms — truthful availability */}
          <nav aria-label={footer.platforms}>
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: F.mint, fontFamily: mono, margin: "0 0 12px" }}>{footer.platforms}</p>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: F.dim, fontFamily: mono, margin: "0 0 8px" }}>{footer.available}</p>
            <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
              {available.map((l) => <li key={l.label}><Link href={l.href} className="tmr-foot-link" style={linkStyle}>{l.label}</Link></li>)}
            </ul>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: F.dim, fontFamily: mono, margin: "0 0 8px" }}>{footer.inDevelopment}</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9, opacity: 0.55 }}>
              {inDev.map((l) => <li key={l.label}><Link href={l.href} className="tmr-foot-link" style={linkStyle}>{l.label}</Link></li>)}
            </ul>
          </nav>

          <Col title="Learn" links={learn} />
          <Col title={footer.company} links={company} />
          <Col title={footer.legal} links={legal} />
        </div>

        {/* Bottom bar */}
        <div style={{ marginTop: 48, borderTop: `1px solid ${F.line}`, padding: "22px 0 30px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: F.dim, fontFamily: mono }}>
            <span>© {year} Tamanor — {footer.rights}</span>
            <span>Operated by Infotech Solutions, s. r. o., {EU[locale]}</span>
          </div>
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: F.dim, fontFamily: mono }}>{footer.badge}</span>
        </div>
      </div>
    </footer>
  );
}
