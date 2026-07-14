import Link from "next/link";
import { Logo } from "./logo";
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
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-bg),transparent_25%)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href={home} className="text-[var(--color-fg)]">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-[var(--color-muted)] md:flex">
          <a href="#platforms" className="transition hover:text-[var(--color-fg)]">{t.nav.platforms}</a>
          <a href="#features" className="transition hover:text-[var(--color-fg)]">{t.nav.features}</a>
          <a href="#product" className="transition hover:text-[var(--color-fg)]">{t.nav.product}</a>
          <a href="#control" className="transition hover:text-[var(--color-fg)]">{t.nav.aiHuman}</a>
          <Link href={`${localePrefix(locale)}/case-studies`} className="transition hover:text-[var(--color-fg)]">{t.nav.caseStudies}</Link>
          <a href="#safety" className="transition hover:text-[var(--color-fg)]">{t.nav.security}</a>
          <a href="#pricing" className="transition hover:text-[var(--color-fg)]">{t.nav.pricing}</a>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher current={locale} variant="marketing" />
          {/* V1.49B — truthful CTA hierarchy: primary = Book a demo (pilot access is via a demo, not
              self-service). The former "Start free trial → /login" implied a self-service trial that
              does not exist (no billing / no public sign-up); replaced with a real "Review security" link. */}
          <Link
            href={`${localePrefix(locale)}/security`}
            className="hidden rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] sm:inline-block"
          >
            {t.common.reviewSecurity}
          </Link>
          <Link
            href="/book-demo"
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_24px_rgba(25,195,154,0.35)] transition hover:bg-[var(--color-brand-strong)]"
          >
            {t.common.bookDemo}
          </Link>
        </div>
      </div>
    </header>
  );
}
