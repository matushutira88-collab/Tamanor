import { getLocale } from "./locale-server";
import { getDictionary, type Dictionary } from "./index";

/** Resolve the active dictionary for the current request (cookie → EN). */
export async function getT(): Promise<Dictionary> {
  return getDictionary(await getLocale());
}

/** Resolve both the active locale and its dictionary in one call. */
export async function getTL() {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
}
