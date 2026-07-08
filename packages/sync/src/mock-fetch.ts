import { ContentKind, Platform, type IsoTimestamp } from "@guardora/core";
import type { FetchedContent } from "@guardora/connectors";

/**
 * MOCK fallback content for placeholder-mode accounts. Every item is clearly
 * labelled [MOCK] and uses a DETERMINISTIC externalId so re-running the sync
 * demonstrates deduplication (first run creates, subsequent runs dedupe).
 *
 * This is NOT real platform data and never pretends to be.
 */
export function mockMetaFetch(
  accountId: string,
  platform: Platform,
): FetchedContent[] {
  const base = accountId.slice(-6);
  const now = Date.now();
  const seeds: Array<{ slug: string; text: string; author: string; daysAgo: number }> = [
    { slug: "c1", text: "[MOCK] Love this place, great service!", author: "mock_happy", daysAgo: 1 },
    { slug: "c2", text: "[MOCK] total scam, do not buy from them", author: "mock_angry", daysAgo: 1 },
    { slug: "c3", text: "[MOCK] Do you ship internationally?", author: "mock_curious", daysAgo: 2 },
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
