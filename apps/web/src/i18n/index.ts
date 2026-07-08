import { en, type Dictionary } from "./dictionaries/en";
import { sk } from "./dictionaries/sk";
import { de } from "./dictionaries/de";
import { defaultLocale, isLocale, type Locale } from "./config";

export type { Dictionary } from "./dictionaries/en";
export * from "./config";

const DICTS: Record<Locale, Dictionary> = { en, sk, de };

/**
 * Return the dictionary for a locale. Unknown/missing locale falls back to EN.
 * Because sk/de are typed as the full Dictionary, per-key coverage is enforced
 * at compile time — no missing-key artifacts can reach the UI.
 */
export function getDictionary(locale: string | undefined | null): Dictionary {
  if (isLocale(locale)) return DICTS[locale];
  return DICTS[defaultLocale];
}
