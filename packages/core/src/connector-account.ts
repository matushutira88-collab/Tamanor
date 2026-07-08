import type {
  BrandId,
  ConnectorAccountId,
  TenantId,
  IsoTimestamp,
} from "./ids";
import type { Platform } from "./platform";
import type { ConnectorHealth, ConnectorMode } from "./connector-mode";

/** Lifecycle state of a connected platform account. */
export enum ConnectorStatus {
  /** OAuth started but not yet completed. */
  Pending = "pending",
  /** Connected and syncing via real OAuth. */
  Active = "active",
  /**
   * A development placeholder "connection" — no real OAuth, no real API access.
   * Used in V1 so the product can be exercised end-to-end without any live
   * platform integration. Never treated as a real connection.
   */
  MockConnected = "mock_connected",
  /** Token expired or revoked — needs reconnect. */
  Expired = "expired",
  /** Disconnected by the user (or never connected). */
  Disconnected = "disconnected",
  /** Platform reported an error state. */
  Error = "error",
}

/**
 * A ConnectorAccount links a Brand to one external platform account via an
 * official OAuth grant. We store ONLY tokens obtained through official OAuth —
 * never client passwords, never scraped sessions.
 *
 * NOTE: This domain type intentionally carries NO token material. Tokens live
 * only in the persistence layer and are never exposed to the UI. See
 * docs/SECURITY.md — production token storage must be encrypted at rest.
 */
export interface ConnectorAccount {
  id: ConnectorAccountId;
  tenantId: TenantId;
  brandId: BrandId;
  platform: Platform;
  status: ConnectorStatus;
  /** Runtime execution mode (gates sync/actions). */
  mode: ConnectorMode;
  /** Connection health for the dashboard. */
  health: ConnectorHealth;
  /** External account/page/channel id on the platform. */
  externalId: string;
  /** Human label shown in the dashboard (e.g. page or channel name). */
  externalName?: string;
  /** Facebook Page id (Meta). */
  pageId?: string;
  /** Instagram Business account id (Meta). */
  igBusinessId?: string;
  /** OAuth scopes requested. */
  scopes: string[];
  /** Permissions actually granted by the user (may differ from scopes). */
  grantedPermissions: string[];
  /** When the current access token expires, if known. */
  tokenExpiresAt?: IsoTimestamp;
  /** Last sync attempt (success or failure). */
  lastSyncedAt?: IsoTimestamp;
  /** Last sync that completed successfully. */
  lastSuccessfulSyncAt?: IsoTimestamp;
  /** Last error message (never contains token material). */
  lastError?: string;
  lastErrorAt?: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
