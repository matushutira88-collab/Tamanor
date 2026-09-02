/**
 * Locale selection — pure, so it is testable without the Expo native module.
 *
 * `index.ts` binds this to the device's preferred languages at startup.
 */

import { en, type Dictionary } from "./en";
import { sk } from "./sk";
import { de } from "./de";

/** The locales Tamanor ships, matching the web product. */
export const LOCALES = ["en", "sk", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const DICTIONARIES: Record<Locale, Dictionary> = { en, sk, de };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Pick the best supported locale from an ordered list of device language tags.
 *
 * Matching is on the primary subtag, so `de-AT` and `sk-SK` resolve to `de` and
 * `sk`. The first supported entry wins, honouring the user's own ordering.
 */
export function resolveLocale(preferred: readonly (string | null | undefined)[]): Locale {
  for (const tag of preferred) {
    const primary = tag?.split("-")[0]?.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/** The dictionary for a locale. */
export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export type { Dictionary };
