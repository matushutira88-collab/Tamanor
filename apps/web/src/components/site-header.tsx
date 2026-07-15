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
  // V1.53A — the section nav links target the localized HOMEPAGE anchor (`${home}#id`), not a
  // same-page `#id`. A bare `#id` only resolves on the homepage; on a sub-page (e.g. /case-studies,
  // which renders this same header via MarketingPage) those anchors don't exist, so the links did
  // nothing — the confirmed defect. Routing to the homepage anchor makes every link work from any
  // page (Next scrolls to the id after navigating; on the homepage it scrolls in place).
  const section = (id: string) => `${home}#${id}`;
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-bg),transparent_25%)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href={home} className="text-[var(--color-fg)]">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-[var(--color-muted)] md:flex">
          <Link href={section("platforms")} className="transition hover:text-[var(--color-fg)]">{t.nav.platforms}</Link>
          <Link href={section("features")} className="transition hover:text-[var(--color-fg)]">{t.nav.features}</Link>
          <Link href={section("product")} className="transition hover:text-[var(--color-fg)]">{t.nav.product}</Link>
          <Link href={section("control")} className="transition hover:text-[var(--color-fg)]">{t.nav.aiHuman}</Link>
          <Link href={`${localePrefix(locale)}/case-studies`} className="transition hover:text-[var(--color-fg)]">{t.nav.caseStudies}</Link>
          <Link href={section("safety")} className="transition hover:text-[var(--color-fg)]">{t.nav.security}</Link>
          <Link href={section("pricing")} className="transition hover:text-[var(--color-fg)]">{t.nav.pricing}</Link>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher current={locale} variant="marketing" />
          {/* V1.50A — self-service CTA hierarchy: secondary = Log in (existing users),
              primary = Start free (self-service registration + 14-day free trial). */}
          <Link
            href="/login"
            className="hidden rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] sm:inline-block"
          >
            {t.common.logIn}
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_24px_rgba(25,195,154,0.35)] transition hover:bg-[var(--color-brand-strong)]"
          >
            {t.common.startFree}
          </Link>
        </div>
      </div>
    </header>
  );
}
