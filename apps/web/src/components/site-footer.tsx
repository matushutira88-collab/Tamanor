import Link from "next/link";
import { getDictionary, defaultLocale, localePrefix, type Dictionary, type Locale } from "@/i18n";

export function SiteFooter({
  dict,
  locale = defaultLocale,
}: {
  dict?: Dictionary;
  locale?: Locale;
}) {
  const t = dict ?? getDictionary(locale);
  const lp = localePrefix(locale);

  const columns: { title: string; links: { label: string; href: string }[] }[] = [
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
      links: [
        { label: "Facebook", href: "/#platforms" },
        { label: "Instagram", href: "/#platforms" },
        { label: "YouTube", href: "/#platforms" },
        { label: "LinkedIn", href: "/#platforms" },
        { label: "TikTok", href: "/#platforms" },
        { label: "Google", href: "/#platforms" },
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
        { label: t.footer.terms, href: "/terms" },
        { label: t.footer.security, href: "/security" },
      ],
    },
  ];

  return (
    <footer className="border-t border-[var(--color-border)]">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <span className="text-lg font-semibold">Tamanor</span>
            <p className="mt-3 max-w-xs text-sm text-[var(--color-muted)]">{t.footer.tagline}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/login" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
                {t.common.startFreeTrial}
              </Link>
              <Link href="/book-demo" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-xs font-semibold transition hover:bg-[var(--color-surface-2)]">
                {t.common.bookDemo}
              </Link>
            </div>
          </div>
          {columns.map((c) => (
            <div key={c.title}>
              <p className="text-sm font-semibold">{c.title}</p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="transition hover:text-[var(--color-fg)]">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-muted)] md:flex-row">
          <span>© {new Date().getFullYear()} Tamanor — {t.footer.rights}</span>
          <span>{t.footer.badge}</span>
        </div>
      </div>
    </footer>
  );
}
