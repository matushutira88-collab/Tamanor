"use client";
/**
 * V1.53 — Consent Mode v2 state. Everything defaults to DENIED (set in the head before gtag loads).
 * Tracking begins only after the visitor grants consent; the choice persists in localStorage and is
 * re-applied on every load. Granting/declining pushes the update to both gtag (Consent Mode) and the
 * Meta Pixel (`fbq('consent', …)`), and notifies in-page trackers so a queued event can flush.
 */
import { CONSENT_DEFAULT_DENIED, CONSENT_GRANTED } from "@guardora/core/analytics";
import "./types";

export const CONSENT_STORAGE_KEY = "tamanor_analytics_consent";
export const CONSENT_CHANGED_EVENT = "tamanor:consent-changed";
export type StoredConsent = "granted" | "denied";

/** The persisted choice, or null if the visitor has not decided yet. */
export function getStoredConsent(): StoredConsent | null {
  try {
    const v = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

/** True only when the visitor has explicitly granted consent. */
export function hasAnalyticsConsent(): boolean {
  return getStoredConsent() === "granted";
}

/** Push the consent state to gtag Consent Mode + the Meta Pixel. Safe if a provider is not loaded. */
export function applyProviderConsent(granted: boolean): void {
  try {
    window.gtag?.("consent", "update", granted ? CONSENT_GRANTED : CONSENT_DEFAULT_DENIED);
  } catch { /* provider not loaded */ }
  try {
    window.fbq?.("consent", granted ? "grant" : "revoke");
  } catch { /* provider not loaded */ }
}

/** Persist the visitor's choice, update providers, and notify trackers. */
export function setConsent(granted: boolean): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, granted ? "granted" : "denied");
  } catch { /* storage blocked — still apply for this session */ }
  applyProviderConsent(granted);
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: { granted } }));
  } catch { /* ignore */ }
}
