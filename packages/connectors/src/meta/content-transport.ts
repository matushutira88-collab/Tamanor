import { MetaGraphClient, MetaGraphError } from "./graph-client";

/**
 * V1.38.1 — the isolated network seam for UNIFIED Meta CONTENT reads (Instagram
 * Professional media + comments). Production uses {@link GraphMetaContentTransport}
 * (real Graph GET reads, gated by META_LIVE_SYNC); tests inject
 * {@link MockMetaContentTransport} so the production ingestion CODE runs against a
 * real DB with NO real network call and NO fake persisted data.
 *
 * The transport is READ-ONLY (GET only) and MUST NOT log the access token.
 */

/** One Instagram media object (post/reel/etc). */
export interface MetaMediaRef {
  id: string;
  permalink?: string;
  /** Publish time of the media (ISO 8601). */
  timestamp?: string;
  caption?: string;
}

/** One Instagram comment. `authorId`/`authorUsername` may be absent (privacy). */
export interface MetaCommentRef {
  id: string;
  /** The media this comment belongs to (external parent id). */
  mediaId: string;
  text: string;
  /** ISO 8601 publish time. */
  timestamp: string;
  /** Commenter username, when the API returns it. */
  authorUsername?: string;
  /** Stable commenter id from `from{id}` — only for owned comments w/ permission. */
  authorId?: string;
  /** Parent comment id when this is a reply, else undefined (top-level). */
  parentCommentId?: string;
}

/** A single page of results plus the Graph paging cursor for the next page. */
export interface MetaContentPage<T> {
  items: T[];
  /** `paging.cursors.after` — present only when another page exists. */
  nextCursor?: string;
}

export interface MetaContentListOptions {
  limit?: number;
  after?: string;
}

export interface MetaContentTransport {
  readonly name: string;
  /** List an IG account's media (one page). Throws {@link MetaGraphError} on failure. */
  listMedia(
    igBusinessId: string,
    accessToken: string,
    opts?: MetaContentListOptions,
  ): Promise<MetaContentPage<MetaMediaRef>>;
  /** List one media's comments (one page). Throws {@link MetaGraphError} on failure. */
  listComments(
    mediaId: string,
    accessToken: string,
    opts?: MetaContentListOptions,
  ): Promise<MetaContentPage<MetaCommentRef>>;
}

interface GraphList<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Real Graph transport — read-only GETs only, follows `paging.cursors.after`.
 * Only used behind the META_LIVE_SYNC gate. Never logs the token.
 */
export class GraphMetaContentTransport implements MetaContentTransport {
  readonly name = "graph";

  async listMedia(
    igBusinessId: string,
    accessToken: string,
    opts: MetaContentListOptions = {},
  ): Promise<MetaContentPage<MetaMediaRef>> {
    const client = new MetaGraphClient(accessToken);
    const query: Record<string, string> = {
      fields: "id,permalink,timestamp,caption",
      limit: String(opts.limit ?? 25),
    };
    if (opts.after) query.after = opts.after;
    const res = await client.get<GraphList<MetaMediaRef>>(`${igBusinessId}/media`, query);
    return {
      items: (res.data ?? []).map((m) => ({
        id: m.id,
        permalink: m.permalink,
        timestamp: m.timestamp,
        caption: m.caption,
      })),
      nextCursor: res.paging?.next ? res.paging?.cursors?.after : undefined,
    };
  }

  async listComments(
    mediaId: string,
    accessToken: string,
    opts: MetaContentListOptions = {},
  ): Promise<MetaContentPage<MetaCommentRef>> {
    const client = new MetaGraphClient(accessToken);
    const query: Record<string, string> = {
      fields: "id,text,timestamp,username,from{id,username},parent{id}",
      limit: String(opts.limit ?? 50),
    };
    if (opts.after) query.after = opts.after;
    const res = await client.get<
      GraphList<{
        id: string;
        text?: string;
        timestamp: string;
        username?: string;
        from?: { id?: string; username?: string };
        parent?: { id?: string };
      }>
    >(`${mediaId}/comments`, query);
    return {
      items: (res.data ?? []).map((c) => ({
        id: c.id,
        mediaId,
        text: c.text ?? "",
        timestamp: c.timestamp,
        authorUsername: c.username ?? c.from?.username,
        authorId: c.from?.id,
        parentCommentId: c.parent?.id,
      })),
      nextCursor: res.paging?.next ? res.paging?.cursors?.after : undefined,
    };
  }
}

/**
 * Mock transport — NO network. Configurable, paginated fixtures; records calls
 * for assertions. A media id present in `throwOnCommentsFor` makes `listComments`
 * throw the given {@link MetaGraphError} (e.g. a deleted/unavailable media).
 */
export class MockMetaContentTransport implements MetaContentTransport {
  readonly name = "mock";
  readonly calls: string[] = [];

  constructor(
    private readonly fixtures: {
      /** IG id → ordered media (paginated by `pageSize`). */
      media?: Record<string, MetaMediaRef[]>;
      /** media id → ordered comments (paginated by `pageSize`). */
      comments?: Record<string, MetaCommentRef[]>;
      /** media id → error to throw from listComments (deleted/unavailable/permission). */
      throwOnCommentsFor?: Record<string, MetaGraphError>;
      /** IG id → error to throw from listMedia. */
      throwOnMediaFor?: Record<string, MetaGraphError>;
      /** Page size for BOTH lists (default 25). */
      pageSize?: number;
    } = {},
  ) {}

  private page<T extends { id: string }>(all: T[], after: string | undefined, size: number): MetaContentPage<T> {
    let start = 0;
    if (after) {
      const idx = all.findIndex((x) => x.id === after);
      start = idx >= 0 ? idx + 1 : all.length;
    }
    const items = all.slice(start, start + size);
    const last = items[items.length - 1];
    const more = last ? all.findIndex((x) => x.id === last.id) < all.length - 1 : false;
    return { items, nextCursor: more && last ? last.id : undefined };
  }

  async listMedia(
    igBusinessId: string,
    _accessToken: string,
    opts: MetaContentListOptions = {},
  ): Promise<MetaContentPage<MetaMediaRef>> {
    this.calls.push(`listMedia:${igBusinessId}:${opts.after ?? ""}`);
    const err = this.fixtures.throwOnMediaFor?.[igBusinessId];
    if (err) throw err;
    const all = this.fixtures.media?.[igBusinessId] ?? [];
    return this.page(all, opts.after, this.fixtures.pageSize ?? 25);
  }

  async listComments(
    mediaId: string,
    _accessToken: string,
    opts: MetaContentListOptions = {},
  ): Promise<MetaContentPage<MetaCommentRef>> {
    this.calls.push(`listComments:${mediaId}:${opts.after ?? ""}`);
    const err = this.fixtures.throwOnCommentsFor?.[mediaId];
    if (err) throw err;
    const all = this.fixtures.comments?.[mediaId] ?? [];
    return this.page(all, opts.after, this.fixtures.pageSize ?? 25);
  }
}
