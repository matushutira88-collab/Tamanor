import type {
  ContentItem,
  ConnectorAccount,
  Platform,
} from "@guardora/core";

/**
 * OAuth context handed to a connector. Guardora only ever holds tokens acquired
 * through a platform's official OAuth flow — never client passwords.
 */
export interface ConnectorAuthContext {
  accessToken: string;
  refreshToken?: string;
  /** External account/page/channel id. */
  externalId: string;
  scopes: string[];
}

/** Parameters for a sync pass. */
export interface SyncOptions {
  /** Only fetch content published/updated after this ISO timestamp. */
  since?: string;
  /** Soft cap on items to pull in one pass. */
  limit?: number;
}

/**
 * Content pulled from a platform, not yet persisted. The worker maps these onto
 * {@link ContentItem} records. Ids/tenant/brand are assigned on ingest.
 */
export type FetchedContent = Omit<
  ContentItem,
  "id" | "tenantId" | "brandId" | "connectorAccountId" | "ingestedAt"
>;

export interface SyncResult {
  items: FetchedContent[];
  /** Cursor/timestamp to resume from on the next pass. */
  nextCursor?: string;
}

/** Result of a moderation call against a platform. */
export interface ActionResult {
  ok: boolean;
  /** Platform-native id of any created object (e.g. a reply id). */
  externalId?: string;
  /** Populated when ok is false. */
  error?: string;
  /** True when the platform API does not support the requested action. */
  unsupported?: boolean;
  /**
   * True when the runtime blocked the action by policy (e.g. read-only mode),
   * distinct from the platform being unable to perform it. Never a fake
   * success — a disabled action always has ok=false.
   */
  disabled?: boolean;
}

/** A reply to post on a piece of content. */
export interface ReplyInput {
  /** Platform-native id of the content being replied to. */
  externalContentId: string;
  text: string;
}

/** Reference to a single piece of content for hide/delete/resolve. */
export interface ContentRef {
  externalContentId: string;
}

/**
 * The unified contract every platform adapter implements. The worker and the
 * moderation pipeline only ever talk to this interface — never to a specific
 * platform SDK.
 *
 * Actions that a platform API does not support MUST return
 * `{ ok: false, unsupported: true }` rather than throwing, so callers can
 * degrade gracefully (e.g. route to human review instead of auto-hide).
 */
export interface PlatformConnector {
  readonly platform: Platform;

  /** Validate/establish an authenticated session from OAuth context. */
  connect(auth: ConnectorAuthContext): Promise<void>;

  /** Pull comments (and comment-like content). */
  syncComments(options?: SyncOptions): Promise<SyncResult>;

  /** Pull reviews. No-op (unsupported) on platforms without reviews. */
  syncReviews(options?: SyncOptions): Promise<SyncResult>;

  /** Post a reply. */
  reply(input: ReplyInput): Promise<ActionResult>;

  /** Hide content from public view, where the API allows. */
  hide(ref: ContentRef): Promise<ActionResult>;

  /** Delete content, where the API allows. */
  delete(ref: ContentRef): Promise<ActionResult>;

  /** Mark content resolved (Guardora-side; some platforms mirror this). */
  markResolved(ref: ContentRef): Promise<ActionResult>;
}

/** Factory signature used by the connector registry. */
export type ConnectorFactory = (account: ConnectorAccount) => PlatformConnector;
