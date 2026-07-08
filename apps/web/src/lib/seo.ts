import type { Metadata } from "next";
import type { Locale } from "@/i18n";

/**
 * Build hreflang + canonical alternates for a marketing route that exists in
 * EN/SK/DE. `enPath` is the English path ("/" or "/case-studies"); resolved
 * against the root `metadataBase` (https://guardora.ai).
 */
export function marketingAlternates(enPath: string, current: Locale): Metadata["alternates"] {
  const suffix = enPath === "/" ? "" : enPath;
  const sk = `/sk${suffix}` || "/sk";
  const de = `/de${suffix}` || "/de";
  const canonical = current === "en" ? enPath : current === "sk" ? sk : de;
  return {
    canonical,
    languages: {
      en: enPath,
      sk,
      de,
      "x-default": enPath,
    },
  };
}
