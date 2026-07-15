/**
 * V1.53 — analytics configuration, resolved from PUBLIC env only (safe in the browser bundle).
 * IDs are pasted at launch; until then everything is dormant and NOTHING loads or tracks. Tracking
 * is PRODUCTION-only: a Vercel preview (`NEXT_PUBLIC_VERCEL_ENV=preview`) or local dev never tracks.
 */

/** Accept an id only when it matches its provider's well-formed shape (a malformed env value that
 *  could break the inline bootstrap script is treated as "not configured"). */
const wellFormed = (raw: string | undefined, re: RegExp): string => {
  const v = raw?.trim() || "";
  return re.test(v) ? v : "";
};
/** Google Analytics 4 measurement id, e.g. `G-XXXXXXXXXX`. Unset/malformed → GA4 not loaded. */
export const GA_MEASUREMENT_ID = wellFormed(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID, /^G-[A-Z0-9]{4,20}$/);
/** Meta Pixel id (numeric). Unset/malformed → Pixel not loaded. */
export const META_PIXEL_ID = wellFormed(process.env.NEXT_PUBLIC_META_PIXEL_ID, /^[0-9]{6,20}$/);
/** Google Ads conversion id, e.g. `AW-XXXXXXXXX`. Unset/malformed → Ads/gtag-for-ads not loaded. */
export const GOOGLE_ADS_ID = wellFormed(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID, /^AW-[0-9]{6,20}$/);

/**
 * PRODUCTION-only gate (preview-safe). Vercel auto-exposes `NEXT_PUBLIC_VERCEL_ENV`
 * ("production" | "preview" | "development"); off Vercel we fall back to NODE_ENV.
 */
export const IS_PRODUCTION_ANALYTICS: boolean = (() => {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv) return vercelEnv === "production";
  return process.env.NODE_ENV === "production";
})();

/** True when at least one provider id is configured. */
export const ANALYTICS_CONFIGURED = Boolean(GA_MEASUREMENT_ID || META_PIXEL_ID || GOOGLE_ADS_ID);

/** The gtag.js loader is shared by GA4 AND Google Ads — load it if either is configured. */
export const GTAG_ENABLED = IS_PRODUCTION_ANALYTICS && Boolean(GA_MEASUREMENT_ID || GOOGLE_ADS_ID);
export const GA4_ENABLED = IS_PRODUCTION_ANALYTICS && Boolean(GA_MEASUREMENT_ID);
export const META_PIXEL_ENABLED = IS_PRODUCTION_ANALYTICS && Boolean(META_PIXEL_ID);
export const GOOGLE_ADS_ENABLED = IS_PRODUCTION_ANALYTICS && Boolean(GOOGLE_ADS_ID);

/** Any provider active in this environment → the consent banner acts as a real consent gate. */
export const ANALYTICS_ACTIVE = IS_PRODUCTION_ANALYTICS && ANALYTICS_CONFIGURED;
