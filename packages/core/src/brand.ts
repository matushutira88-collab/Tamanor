import type { BrandId, TenantId, IsoTimestamp } from "./ids";
import type { Platform } from "./platform";

/** Lifecycle state of a brand. */
export enum BrandStatus {
  Active = "active",
  Paused = "paused",
  Archived = "archived",
}

/** Default tone Guardora uses when drafting replies for a brand. */
export enum BrandTone {
  Professional = "professional",
  Friendly = "friendly",
  Formal = "formal",
  Casual = "casual",
  Empathetic = "empathetic",
}

/**
 * A Brand is a single protected identity owned by a Tenant. One tenant (account)
 * can hold many brands, and each brand can connect many platform accounts.
 */
export interface Brand {
  id: BrandId;
  tenantId: TenantId;
  name: string;
  /** Optional public-facing display name / handle. */
  displayName?: string;
  /** Default reply language (BCP-47), e.g. "en", "de", "sk". */
  defaultLocale: string;
  /** IANA timezone, e.g. "Europe/Bratislava". */
  timezone: string;
  /** Default tone for drafted replies. */
  defaultTone: BrandTone;
  status: BrandStatus;
  /** Platforms this brand is currently connected to. */
  connectedPlatforms: Platform[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
