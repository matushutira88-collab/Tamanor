import { ContentKind, Platform as CorePlatform, type IsoTimestamp } from "@guardora/core";
import {
  MetaGraphError,
  type FetchedContent,
  type MetaContentTransport,
} from "@guardora/connectors";

/**
 * V1.38.1 — Instagram content ingestion driver.
 *
 * Drives REAL pagination over an Instagram Professional account's media → comments
 * through an injected {@link MetaContentTransport} (Graph in production, Mock in tests),
 * normalizes each comment into a {@link FetchedContent}, and returns a paging cursor +
 * a truthful permission/health state. It NEVER fabricates content and NEVER logs tokens.
 *
 * It performs provider HTTP ONLY — the caller (runReadOnlySync) persists the result
 * through the single idempotent ingest path (lease + RLS + atomic ContentItem/ReputationItem).
 */

/**
 * The 8 truthful Instagram permission/availability states surfaced to diagnostics/UI.
 * `healthy` = read succeeded. The remaining states are only ever set from a REAL signal
 * (a Graph error code or a discovery fact) — never guessed.
 */
export type IgPermissionState =
  | "healthy"
  | "permission_missing"
  | "app_review_pending"
  | "business_verification_required"
  | "token_expired"
  | "instagram_not_linked"
  | "professional_account_required"
  | "account_not_discoverable"
  | "api_unavailable"
  | "rate_limited";

/** Bounded page caps — surfaced via `truncated`, never a silent cut. */
export const IG_MAX_MEDIA_PAGES = 20;
export const IG_MAX_COMMENT_PAGES_PER_MEDIA = 20;

export interface IgIngestResult {
  items: FetchedContent[];
  /** Media paging cursor to resume from next pass (persisted as lastCursor). */
  cursor?: string;
  /** True when a page cap was hit — more content remains (not a silent truncation). */
  truncated: boolean;
  /** Count of media whose comments could not be read (deleted/unavailable). */
  skippedMedia: number;
  mediaScanned: number;
}

/**
 * Map a Graph error to a truthful IG permission/availability state. Deterministic on
 * documented Graph codes only. Ambiguous app-config states (app_review_pending,
 * business_verification_required, professional_account_required) are NOT inferred from a
 * generic read error — they are set upstream (OAuth/discovery) when a real signal exists,
 * so this classifier never fabricates them.
 */
export function classifyIgPermissionState(err: unknown): IgPermissionState {
  if (err instanceof MetaGraphError) {
    const { kind, code, subcode, status } = err.detail;
    if (kind === "token_expired") return "token_expired";
    if (kind === "rate_limit") return "rate_limited";
    if (status === 404 || code === 803 || code === 33) return "account_not_discoverable";
    if (status >= 500 || code === 1 || code === 2) return "api_unavailable";
    // Subcode 2207032/2207003-class = business/app review gating on IG endpoints.
    if (subcode === 2207032) return "business_verification_required";
    if (kind === "permission") return "permission_missing";
    return "api_unavailable";
  }
  // Network / non-Graph error — the API was unreachable, not a permission fact.
  return "api_unavailable";
}

/** True when a media-level error means "this media is gone", not "the account failed". */
function isMediaUnavailable(err: unknown): boolean {
  if (!(err instanceof MetaGraphError)) return false;
  const { status, code } = err.detail;
  return status === 404 || code === 803 || code === 33 || code === 100;
}

/**
 * Fetch & normalize Instagram comments for an account. Provider HTTP only.
 *
 * @param igBusinessId  the account's canonical IG Business id (from ConnectedAccount)
 * @param accessToken   decrypted Page/IG token (never logged)
 * @param transport     injected content transport (Graph in prod, Mock in tests)
 * @param opts.after    media cursor to resume incremental reads
 */
export async function fetchInstagramContent(
  igBusinessId: string,
  accessToken: string,
  transport: MetaContentTransport,
  opts: { after?: string; mediaLimit?: number; commentLimit?: number } = {},
): Promise<IgIngestResult> {
  const items: FetchedContent[] = [];
  let mediaScanned = 0;
  let skippedMedia = 0;
  let truncated = false;

  let mediaCursor = opts.after;
  let mediaPage = 0;
  let lastMediaCursor: string | undefined = opts.after;

  // Outer loop: media pages (bounded).
  for (;;) {
    if (mediaPage >= IG_MAX_MEDIA_PAGES) {
      truncated = true;
      break;
    }
    const media = await transport.listMedia(igBusinessId, accessToken, {
      after: mediaCursor,
      limit: opts.mediaLimit,
    });
    mediaPage++;

    for (const m of media.items) {
      mediaScanned++;
      try {
        await collectComments(m, igBusinessId, accessToken, transport, items, opts.commentLimit);
      } catch (err) {
        // A single deleted/unavailable media is isolated — the account read continues.
        if (isMediaUnavailable(err)) {
          skippedMedia++;
          continue;
        }
        // Any other error (token/permission/rate-limit/network) is account-level: rethrow.
        throw err;
      }
    }

    if (!media.nextCursor) break;
    lastMediaCursor = media.nextCursor;
    mediaCursor = media.nextCursor;
  }

  return { items, cursor: lastMediaCursor, truncated, skippedMedia, mediaScanned };
}

/** Paginate one media's comments (bounded) and append normalized items. */
async function collectComments(
  media: { id: string; permalink?: string },
  igBusinessId: string,
  accessToken: string,
  transport: MetaContentTransport,
  out: FetchedContent[],
  commentLimit: number | undefined,
): Promise<void> {
  let after: string | undefined;
  let page = 0;
  for (;;) {
    if (page >= IG_MAX_COMMENT_PAGES_PER_MEDIA) return;
    const res = await transport.listComments(media.id, accessToken, { after, limit: commentLimit });
    page++;
    for (const c of res.items) {
      if (!c.text) continue; // never invent text
      out.push({
        platform: CorePlatform.InstagramBusiness,
        kind: ContentKind.Comment,
        externalId: c.id,
        externalParentId: c.parentCommentId ?? media.id,
        text: c.text,
        author: { externalId: c.authorId, displayName: c.authorUsername },
        publishedAt: c.timestamp as IsoTimestamp,
        permalink: media.permalink,
      });
    }
    if (!res.nextCursor) return;
    after = res.nextCursor;
  }
}
