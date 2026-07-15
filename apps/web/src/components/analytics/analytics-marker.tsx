"use client";
/**
 * V1.53A — server→client delivery of SUCCESS events. Server code must never call gtag/fbq. Instead a
 * server action that commits a real transaction redirects with a one-time `?ae=<event>` marker; this
 * component consumes it exactly once:
 *   1. reads `?ae` from the current URL,
 *   2. STRIPS it via history.replaceState BEFORE firing (so refresh / back / rerender cannot re-fire),
 *   3. fires `track(event)` only if the value is a known canonical event (allowlisted).
 *
 * The marker is a plain event name — no PII, no id, no token. Delivery still respects consent + the
 * production/env gates inside `track()`. Idempotent: webhook retries never reach the browser, and a
 * refresh sees a cleaned URL.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isAnalyticsEvent } from "@guardora/core/analytics";
import { track } from "@/lib/analytics/track";

/** The query key carrying a one-time analytics success marker. */
export const ANALYTICS_MARKER_PARAM = "ae";

export function AnalyticsMarker() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const ae = url.searchParams.get(ANALYTICS_MARKER_PARAM);
      if (!ae) return;
      // Consume: remove the marker from the URL first, so nothing can re-fire it.
      url.searchParams.delete(ANALYTICS_MARKER_PARAM);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      if (isAnalyticsEvent(ae)) track(ae);
    } catch {
      /* URL parsing / history unavailable — no-op */
    }
  }, [pathname]);
  return null;
}
