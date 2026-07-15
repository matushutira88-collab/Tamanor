/**
 * V1.53 — typed browser globals for the analytics providers. Kept minimal and honest: the exact
 * shapes we actually call. No `any`.
 */
import type { AnalyticsParams, ConsentState } from "@guardora/core/analytics";

/** gtag.js signature (GA4 + Google Ads share the same command queue). */
export type GtagFn = {
  (command: "js", date: Date): void;
  (command: "config", targetId: string, params?: Record<string, AnalyticsParamValue>): void;
  (command: "event", eventName: string, params?: Record<string, AnalyticsParamValue>): void;
  (command: "consent", subcommand: "default" | "update", params: Partial<ConsentState> & { wait_for_update?: number }): void;
  (command: "set", params: Record<string, AnalyticsParamValue>): void;
};

/** Meta Pixel `fbq` signature (only the commands we use). */
export type FbqFn = {
  (command: "init", pixelId: string): void;
  (command: "consent", action: "grant" | "revoke"): void;
  (command: "track", eventName: string, params?: Record<string, AnalyticsParamValue>): void;
  (command: "trackCustom", eventName: string, params?: Record<string, AnalyticsParamValue>): void;
  queue?: unknown[];
  loaded?: boolean;
};

type AnalyticsParamValue = AnalyticsParams[string];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

export {};
