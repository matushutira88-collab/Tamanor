import Link from "next/link";

/**
 * V1.58D.2 — global public footer in the landing-v2 "mission control" visual language.
 * Reusable, no client hooks (pure static markup — negligible hydration), semantic <footer>/<nav>,
 * focus-visible states, AA-contrast colours on the dark surface, motion-reduce safe.
 *
 * Content mirrors the shipped global SiteFooter (truthful, production-verified routes): the two
 * live Meta providers are shown as available; the rest are visibly de-emphasised and captioned
 * "In development" — status by caption + reduced emphasis, never colour alone. English copy to
 * match the English v2 homepage; /sk and /de continue to render the localized SiteFooter.
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

export function FooterV2() {
  const year = new Date().getFullYear();
  const product: L[] = [
    { label: "Inbox", href: "/login" }, { label: "Approvals", href: "/login" },
    { label: "Insights", href: "/login" }, { label: "Reports", href: "/login" }, { label: "Audit log", href: "/login" },
  ];
  const learn: L[] = [
    { label: "Platform & architecture", href: "/platform" }, { label: "Features", href: "/features" },
    { label: "Integrations", href: "/integrations" }, { label: "Compare", href: "/compare" },
    { label: "Documentation", href: "/docs" }, { label: "AI discoverability", href: "/ai" },
  ];
  const company: L[] = [
    { label: "About", href: "/about" }, { label: "Example scenarios", href: "/case-studies" }, { label: "Contact", href: "/contact" },
  ];
  const legal: L[] = [
    { label: "Privacy", href: "/privacy" }, { label: "Cookies", href: "/cookies" },
    { label: "Terms", href: "/terms" }, { label: "Security", href: "/security" },
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
              The live reputation firewall for your connected social accounts — spam, scams and threats stopped at the wall, real feedback delivered. Humans approve every action.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Link href="/register" className="tmr-foot-link" style={{ background: F.mint, color: "#04140f", padding: "9px 16px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono, textDecoration: "none" }}>Start for free</Link>
              <Link href="/login" className="tmr-foot-link" style={{ border: `1px solid ${F.line}`, color: F.text, padding: "9px 16px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono, textDecoration: "none" }}>Log in</Link>
            </div>
          </div>

          <Col title="Product" links={product} />

          {/* Platforms — truthful availability */}
          <nav aria-label="Platforms">
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: F.mint, fontFamily: mono, margin: "0 0 12px" }}>Platforms</p>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: F.dim, fontFamily: mono, margin: "0 0 8px" }}>Available now</p>
            <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
              {available.map((l) => <li key={l.label}><Link href={l.href} className="tmr-foot-link" style={linkStyle}>{l.label}</Link></li>)}
            </ul>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: F.dim, fontFamily: mono, margin: "0 0 8px" }}>In development</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9, opacity: 0.55 }}>
              {inDev.map((l) => <li key={l.label}><Link href={l.href} className="tmr-foot-link" style={linkStyle}>{l.label}</Link></li>)}
            </ul>
          </nav>

          <Col title="Learn" links={learn} />
          <Col title="Company" links={company} />
          <Col title="Legal" links={legal} />
        </div>

        {/* Bottom bar */}
        <div style={{ marginTop: 48, borderTop: `1px solid ${F.line}`, padding: "22px 0 30px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: F.dim, fontFamily: mono }}>
            <span>© {year} Tamanor — European reputation-security platform</span>
            <span>Operated by Infotech Solutions, s. r. o., European Union</span>
          </div>
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: F.dim, fontFamily: mono }}>Read-only by default · Official OAuth only · No scraping</span>
        </div>
      </div>
    </footer>
  );
}
