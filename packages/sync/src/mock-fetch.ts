import { ContentKind, Platform, type IsoTimestamp } from "@guardora/core";
import type { FetchedContent } from "@guardora/connectors";

/**
 * MOCK fallback content for placeholder-mode accounts. This is NOT real platform
 * data: it is tracked as mock via the `mock_` externalId prefix and the
 * SyncRun.mock flag (never shown as a visible "[MOCK]" tag in the UI). The
 * DETERMINISTIC externalId means re-running the sync demonstrates deduplication
 * (first run creates, subsequent runs dedupe).
 */
export function mockMetaFetch(
  accountId: string,
  platform: Platform,
): FetchedContent[] {
  const base = accountId.slice(-6);
  const now = Date.now();
  const seeds: Array<{ slug: string; text: string; author: string; daysAgo: number }> = [
    { slug: "c1", text: "Love this place, great service!", author: "mock_happy", daysAgo: 1 },
    { slug: "c2", text: "total scam, do not buy from them", author: "mock_angry", daysAgo: 1 },
    { slug: "c3", text: "Do you ship internationally?", author: "mock_curious", daysAgo: 2 },
  ];

  return seeds.map((s) => ({
    platform,
    kind: ContentKind.Comment,
    externalId: `mock_${platform}_${base}_${s.slug}`,
    externalParentId: `mock_post_${base}`,
    text: s.text,
    author: { displayName: s.author },
    publishedAt: new Date(now - s.daysAgo * 86_400_000).toISOString() as IsoTimestamp,
    permalink: undefined,
  }));
}
