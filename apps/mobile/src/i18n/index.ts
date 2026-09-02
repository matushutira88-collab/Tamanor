/**
 * Mobile localization.
 *
 * LOCALE SOURCE OF TRUTH: the device's preferred languages, read once at startup
 * via `expo-localization`, matched against the locales Tamanor ships. English is
 * the fallback for anything else.
 *
 * The server is NOT the source of truth here, and deliberately so: the M2 session
 * response carries no locale, and the web resolves locale from its own cookie /
 * Accept-Language — a browser concept that does not describe a phone. When a
 * per-user language preference ships, this module gains a preference lookup and
 * everything downstream keeps working.
 *
 * This module is plain TypeScript with no Next.js or server-only imports; the web
 * `@/i18n` dictionaries are never imported into React Native. The selection logic
 * itself lives in `./locale` so it stays testable off-device.
 */

import { getLocales } from "expo-localization";

import { dictionaryFor, resolveLocale, type Dictionary, type Locale } from "./locale";

export {
  LOCALES, DEFAULT_LOCALE, isLocale, resolveLocale, dictionaryFor,
} from "./locale";
export type { Locale, Dictionary } from "./locale";

/**
 * The active locale for this launch.
 *
 * Read once at module load: `getLocales()` is a synchronous native read, and the
 * app does not support switching language at runtime yet (changing the phone's
 * language restarts the app anyway).
 */
export const activeLocale: Locale = resolveLocale(
  (() => {
    try {
      return getLocales().map((l) => l.languageTag);
    } catch {
      // A locale read must never be able to prevent the app from starting.
      return [];
    }
  })(),
);

/** The active dictionary — what screens use. */
export const t: Dictionary = dictionaryFor(activeLocale);
