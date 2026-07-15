"use client";
/**
 * V1.53 — fire a single analytics event when this mounts. Drop it into a server page/section to
 * record a "viewed" event without making the whole page a client component. Renders nothing.
 * @example <TrackView event="pricing_viewed" />
 */
import { useEffect } from "react";
import type { AnalyticsEventName, AnalyticsParams } from "@guardora/core/analytics";
import { track } from "@/lib/analytics/track";

export function TrackView({ event, params }: { event: AnalyticsEventName; params?: AnalyticsParams }) {
  // Fire once per mount for this event; params are static labels.
  useEffect(() => {
    track(event, params);
  }, [event, params]);
  return null;
}
