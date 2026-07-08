export const locales = ["en", "sk", "de"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const LOCALE_COOKIE = "guardora_locale";

export const localeNames: Record<Locale, string> = {
  en: "English",
  sk: "Slovenčina",
  de: "Deutsch",
};

/** Short label used in compact switchers. */
export const localeShort: Record<Locale, string> = {
  en: "EN",
  sk: "SK",
  de: "DE",
};

export function isLocale(x: string | undefined | null): x is Locale {
  return !!x && (locales as readonly string[]).includes(x);
}

/** Marketing path prefix for a locale ("" for EN, "/sk", "/de"). */
export function localePrefix(locale: Locale): string {
  return locale === defaultLocale ? "" : `/${locale}`;
}
