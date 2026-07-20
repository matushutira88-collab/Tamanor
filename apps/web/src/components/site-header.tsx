import Link from "next/link";
import { Logo } from "./logo";
import { SectionLink } from "./section-link";
import { LanguageSwitcher } from "./language-switcher";
import { getDictionary, defaultLocale, localePrefix, type Dictionary, type Locale } from "@/i18n";

export function SiteHeader({
  dict,
  locale = defaultLocale,
}: {
  dict?: Dictionary;
  locale?: Locale;
}) {
  const t = dict ?? getDictionary(locale);
  const home = localePrefix(locale) || "/";
  // V1.53A/B — the section nav items target homepage sections. V1.53A made the href the localized
  // HOMEPAGE anchor (`${home}#id`, not a dead same-page `#id`); V1.53B makes the navigation itself
  // deterministic via <SectionLink> (explicit router.push + guaranteed scroll after cross-route load),
  // so a click from a sub-page (e.g. /case-studies) reliably lands on the section on the first click.
  const cls = "transition hover:text-[var(--color-fg)]";
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-bg),transparent_25%)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href={home} className="text-[var(--color-fg)]">
          <Logo compactOnMobile />
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-[var(--color-muted)] md:flex">
          <SectionLink home={home} section="platforms" className={cls}>{t.nav.platforms}</SectionLink>
          <SectionLink home={home} section="features" className={cls}>{t.nav.features}</SectionLink>
          <SectionLink home={home} section="product" className={cls}>{t.nav.product}</SectionLink>
          <SectionLink home={home} section="control" className={cls}>{t.nav.aiHuman}</SectionLink>
          <Link href={`${localePrefix(locale)}/case-studies`} className={cls}>{t.nav.caseStudies}</Link>
          <SectionLink home={home} section="safety" className={cls}>{t.nav.security}</SectionLink>
          <SectionLink home={home} section="pricing" className={cls}>{t.nav.pricing}</SectionLink>
        </nav>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher current={locale} variant="marketing" />
          {/* V1.50A — self-service CTA hierarchy: secondary = Log in (existing users),
              primary = Start free (self-service registration + 14-day free trial).
              V1.66 — Log in is now reachable on MOBILE too (it used to be `hidden sm:inline-block`, so
              phone visitors had no way back into their account without a hamburger). It stays the
              low-emphasis action: on mobile a borderless text link, from sm: the unchanged bordered
              button. Desktop rendering is byte-for-byte what it was. */}
          <Link
            href="/login"
            className="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 sm:border sm:border-[var(--color-border-strong)] sm:px-4"
          >
            {t.common.logIn}
          </Link>
          {/* Start free stays the ONLY primary CTA. On mobile it uses the short label so the bar never
              wraps at 320px; aria-label keeps the full action name for screen readers at every width. */}
          <Link
            href="/register"
            aria-label={t.common.startFree}
            className="whitespace-nowrap rounded-lg bg-[var(--color-brand)] px-3 py-2 text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_24px_rgba(25,195,154,0.35)] transition hover:bg-[var(--color-brand-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 sm:px-4"
          >
            <span className="sm:hidden">{t.common.startFreeShort}</span>
            <span className="hidden sm:inline">{t.common.startFree}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
