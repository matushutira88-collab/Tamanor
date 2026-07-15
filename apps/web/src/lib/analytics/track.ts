"use client";
/**
 * V1.53 — the SINGLE analytics API. Call `track("event_name", { safe: "labels" })` anywhere in the
 * client; provider fan-out (GA4, Meta Pixel, Google Ads) and event mapping stay internal here.
 *
 * Every dispatch is gated three ways: production environment, an id configured for that provider,
 * and explicit visitor consent. Params pass through the privacy filter ({@link sanitizeAnalyticsParams})
 * so no PII/secret/identifier can ever reach a provider. Nothing fires automatically for Ads.
 */
import {
  type AnalyticsEventName, type AnalyticsParams,
  sanitizeAnalyticsParams, sanitizePagePath, META_PIXEL_STANDARD_EVENTS,
} from "@guardora/core/analytics";
import {
  IS_PRODUCTION_ANALYTICS, GA4_ENABLED, META_PIXEL_ENABLED, GOOGLE_ADS_ENABLED, GOOGLE_ADS_ID,
} from "./config";
import { hasAnalyticsConsent } from "./consent";
import "./types";

/** True only when it is safe to emit: production, and the visitor granted consent. */
function canEmit(): boolean {
  return typeof window !== "undefined" && IS_PRODUCTION_ANALYTICS && hasAnalyticsConsent();
}

/**
 * Track a product event. No-op unless production + consent-granted + a provider is configured.
 * @example track("registration_started")
 * @example track("checkout_started", { plan: "growth", interval: "monthly" })
 */
export function track(event: AnalyticsEventName, params?: AnalyticsParams): void {
  if (!canEmit()) return;
  const clean = sanitizeAnalyticsParams(params);

  if (GA4_ENABLED && typeof window.gtag === "function") {
    window.gtag("event", event, clean);
  }
  if (META_PIXEL_ENABLED && typeof window.fbq === "function") {
    const std = META_PIXEL_STANDARD_EVENTS[event];
    if (std) window.fbq("track", std, clean);
    else window.fbq("trackCustom", event, clean);
  }
}

/** SPA page_view — fired on initial load and every client route change (see AnalyticsProvider).
 *  The path is sanitized: query string dropped (no `?token=`/`?code=`/`?ae=`) + entity ids normalized. */
export function trackPageView(path: string): void {
  if (!canEmit()) return;
  const page_path = sanitizePagePath(path);
  if (GA4_ENABLED && typeof window.gtag === "function") {
    window.gtag("event", "page_view", { page_path });
  }
  if (META_PIXEL_ENABLED && typeof window.fbq === "function") {
    window.fbq("track", "PageView");
  }
}

/**
 * Google Ads conversion helper. NEVER called automatically — a conversion fires only when a call
 * site explicitly invokes it with a configured conversion label. Prepared for future advertising.
 * @example trackConversion("AbC-D_efGhI")  // the conversion label from Google Ads
 */
export function trackConversion(conversionLabel: string, params?: AnalyticsParams): void {
  if (!canEmit() || !GOOGLE_ADS_ENABLED || typeof window.gtag !== "function") return;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversionLabel)) return;
  window.gtag("event", "conversion", { send_to: `${GOOGLE_ADS_ID}/${conversionLabel}`, ...sanitizeAnalyticsParams(params) });
}
