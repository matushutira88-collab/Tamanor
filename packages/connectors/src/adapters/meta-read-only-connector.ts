import { ContentKind, Platform, type IsoTimestamp } from "@guardora/core";
import { MetaGraphClient } from "../meta/graph-client";
import type {
  ActionResult,
  ConnectorAuthContext,
  ContentRef,
  FetchedContent,
  PlatformConnector,
  ReplyInput,
  SyncOptions,
  SyncResult,
} from "../types";

/**
 * MetaReadOnlyConnector — real, READ-ONLY Meta adapter (Facebook Page +
 * Instagram Business). It performs official Graph API GET reads only.
 *
 * Moderation actions are intentionally NOT implemented — they return
 * `{ ok:false, disabled:true }`. The {@link ConnectorRuntime} also blocks them,
 * so this is defense in depth. No POST/DELETE is ever issued in V1.2.
 */
export class MetaReadOnlyConnector implements PlatformConnector {
  readonly platform: Platform;
  private client?: MetaGraphClient;
  private targetId = "";

  constructor(platform: Platform = Platform.FacebookPage) {
    this.platform = platform;
  }

  async connect(auth: ConnectorAuthContext): Promise<void> {
    if (!auth.accessToken) {
      throw new Error("MetaReadOnlyConnector requires an access token.");
    }
    this.client = new MetaGraphClient(auth.accessToken);
    this.targetId = auth.externalId;
  }

  async syncComments(options?: SyncOptions): Promise<SyncResult> {
    if (!this.client) throw new Error("Connector not connected.");
    const limit = String(options?.limit ?? 50);

    if (this.platform === Platform.InstagramBusiness) {
      return this.syncInstagramComments(limit);
    }
    return this.syncFacebookComments(limit);
  }

  /** Facebook: page feed → nested comments. */
  private async syncFacebookComments(limit: string): Promise<SyncResult> {
    const feed = await this.client!.get<{ data: FbPost[] }>(
      `${this.targetId}/feed`,
      {
        fields: `id,permalink_url,comments.limit(${limit}){id,message,created_time,from{id,name}}`,
        limit,
      },
    );
    const items: FetchedContent[] = [];
    for (const post of feed.data ?? []) {
      for (const c of post.comments?.data ?? []) {
        if (!c.message) continue;
        items.push({
          platform: this.platform,
          kind: ContentKind.Comment,
          externalId: c.id,
          externalParentId: post.id,
          text: c.message,
          author: { externalId: c.from?.id, displayName: c.from?.name },
          publishedAt: c.created_time as IsoTimestamp,
          permalink: post.permalink_url,
        });
      }
    }
    return { items, nextCursor: latestCursor(items) };
  }

  /** Instagram: media → comments. */
  private async syncInstagramComments(limit: string): Promise<SyncResult> {
    const media = await this.client!.get<{ data: IgMedia[] }>(
      `${this.targetId}/media`,
      {
        fields: `id,permalink,comments.limit(${limit}){id,text,timestamp,username}`,
        limit,
      },
    );
    const items: FetchedContent[] = [];
    for (const m of media.data ?? []) {
      for (const c of m.comments?.data ?? []) {
        if (!c.text) continue;
        items.push({
          platform: this.platform,
          kind: ContentKind.Comment,
          externalId: c.id,
          externalParentId: m.id,
          text: c.text,
          author: { displayName: c.username },
          publishedAt: c.timestamp as IsoTimestamp,
          permalink: m.permalink,
        });
      }
    }
    return { items, nextCursor: latestCursor(items) };
  }

  async syncReviews(_options?: SyncOptions): Promise<SyncResult> {
    // Facebook page ratings are not synced in V1.2 (comments-first). No-op.
    return { items: [] };
  }

  // --- Moderation actions: disabled in the read-only connector ---------------
  async reply(_input: ReplyInput): Promise<ActionResult> {
    return this.disabled();
  }
  async hide(_ref: ContentRef): Promise<ActionResult> {
    return this.disabled();
  }
  async delete(_ref: ContentRef): Promise<ActionResult> {
    return this.disabled();
  }
  async markResolved(_ref: ContentRef): Promise<ActionResult> {
    return { ok: true };
  }

  private disabled(): ActionResult {
    return {
      ok: false,
      disabled: true,
      error: "Read-only Meta connector: moderation actions are disabled (V1.2).",
    };
  }
}

/** Most recent publishedAt among fetched items (used as an external cursor). */
function latestCursor(items: FetchedContent[]): string | undefined {
  let max: string | undefined;
  for (const it of items) {
    const ts = it.publishedAt as unknown as string;
    if (!max || ts > max) max = ts;
  }
  return max;
}

interface FbPost {
  id: string;
  permalink_url?: string;
  comments?: { data: FbComment[] };
}
interface FbComment {
  id: string;
  message?: string;
  created_time: string;
  from?: { id: string; name: string };
}
interface IgMedia {
  id: string;
  permalink?: string;
  comments?: { data: IgComment[] };
}
interface IgComment {
  id: string;
  text?: string;
  timestamp: string;
  username?: string;
}
