/**
 * V1.32A Instagram Business connector — READ-ONLY comment sync.
 *
 * Guardora reads and analyzes Instagram comments through the existing Meta OAuth
 * connection. No moderation action is enabled (no hide/unhide/delete/reply/like/
 * ban/report) — capabilities gate every action to `missing_capability`.
 *
 * This module holds the deterministic, testable parts: account discovery from a
 * connected Facebook Page, comment normalization, and dedupe. Real Graph fetches
 * reuse the existing Meta read-only sync path — no fabricated data is ever created.
 */
import {
  INSTAGRAM_CAPABILITIES, actorIdentityKey, mapInstagramSyncError,
  type NormalizedComment, type PlatformCapabilities, type PlatformKey, type PlatformSyncErrorReason,
} from "@guardora/core";

/** Raw Instagram comment shape as returned by the Graph API (subset we use). */
export interface RawInstagramComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; caption?: string; permalink?: string };
}

/** Raw Facebook Page node that may carry a linked IG Business account. */
export interface RawPageWithInstagram {
  id: string;
  name?: string;
  instagram_business_account?: { id: string; username?: string } | null;
  connected_instagram_account?: { id: string; username?: string } | null;
}

/** A discovered Instagram Business account linked to a Facebook Page. */
export interface DiscoveredInstagramAccount {
  externalId: string;
  username?: string;
  /** The Facebook Page this IG account is linked to (relationship preserved). */
  linkedPageId: string;
}

/**
 * Discover the Instagram Business account linked to a Facebook Page, if any.
 * Returns null when the Page has no linked IG Business account (a normal, non-error
 * state the UI explains in plain language).
 */
export function findLinkedInstagramAccount(page: RawPageWithInstagram): DiscoveredInstagramAccount | null {
  const ig = page.instagram_business_account ?? page.connected_instagram_account ?? null;
  if (!ig?.id) return null;
  return { externalId: ig.id, username: ig.username, linkedPageId: page.id };
}

/** Normalize one raw Instagram comment into Guardora's platform-agnostic shape. */
export function normalizeInstagramComment(raw: RawInstagramComment, accountId: string): NormalizedComment {
  return {
    platform: "instagram",
    accountId,
    externalCommentId: raw.id,
    externalPostId: raw.media?.id,
    authorExternalId: raw.from?.id,
    authorDisplayName: raw.from?.username ?? raw.username,
    text: raw.text ?? "",
    createdAt: raw.timestamp ? new Date(raw.timestamp) : new Date(0),
    postSnippet: raw.media?.caption?.slice(0, 120),
    permalink: raw.media?.permalink,
  };
}

/** Dedupe normalized comments by platform + externalCommentId (stable, order-preserving). */
export function dedupeNormalizedComments(comments: NormalizedComment[]): NormalizedComment[] {
  const seen = new Set<string>();
  const out: NormalizedComment[] = [];
  for (const c of comments) {
    const key = `${c.platform}:${c.externalCommentId ?? ""}`;
    if (c.externalCommentId && seen.has(key)) continue;
    if (c.externalCommentId) seen.add(key);
    out.push(c);
  }
  return out;
}

/** Diagnostics for one Instagram read-only sync pass (Advanced / internal only). */
export interface InstagramSyncDiagnostics {
  accountFound: boolean;
  permissionMissing: boolean;
  mediaCount: number;
  commentsFetched: number;
  dedupedCount: number;
  error?: PlatformSyncErrorReason;
}

/**
 * The Instagram Business connector — read-only. Moderation methods are absent by
 * design; capabilities report every action as unavailable.
 */
export interface InstagramReadOnlyConnector {
  readonly platform: PlatformKey;
  readonly capabilities: PlatformCapabilities;
  findLinkedAccount: typeof findLinkedInstagramAccount;
  normalizeComment: typeof normalizeInstagramComment;
  dedupe: typeof dedupeNormalizedComments;
  mapSyncError: typeof mapInstagramSyncError;
  actorKey(authorExternalId?: string | null, authorDisplayName?: string | null): string | null;
}

export const instagramConnector: InstagramReadOnlyConnector = {
  platform: "instagram",
  capabilities: INSTAGRAM_CAPABILITIES,
  findLinkedAccount: findLinkedInstagramAccount,
  normalizeComment: normalizeInstagramComment,
  dedupe: dedupeNormalizedComments,
  mapSyncError: mapInstagramSyncError,
  actorKey: (id, name) => actorIdentityKey("instagram", id, name),
};

/** Read-only sync connector registry (V1.32A: Instagram only). */
export function getReadOnlySyncConnector(platform: PlatformKey): InstagramReadOnlyConnector | null {
  return platform === "instagram" ? instagramConnector : null;
}
