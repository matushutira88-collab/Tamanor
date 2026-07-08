/**
 * Platforms Guardora can protect. This enum is the single source of truth
 * used across connectors, the AI engine, and the dashboard.
 */
export enum Platform {
  FacebookPage = "facebook_page",
  InstagramBusiness = "instagram_business",
  YouTube = "youtube",
  LinkedInCompany = "linkedin_company",
  TikTok = "tiktok",
  GoogleBusiness = "google_business",
}

export const ALL_PLATFORMS: readonly Platform[] = Object.values(Platform);

/** Human-facing metadata for a platform. */
export interface PlatformMeta {
  platform: Platform;
  label: string;
  /** Whether the platform exposes user reviews (vs. only comments). */
  supportsReviews: boolean;
  /** Whether the platform API allows hiding content. */
  supportsHide: boolean;
  /** Whether the platform API allows deleting content. */
  supportsDelete: boolean;
  /** Whether the platform API allows replying programmatically. */
  supportsReply: boolean;
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  [Platform.FacebookPage]: {
    platform: Platform.FacebookPage,
    label: "Facebook Page",
    supportsReviews: true,
    supportsHide: true,
    supportsDelete: true,
    supportsReply: true,
  },
  [Platform.InstagramBusiness]: {
    platform: Platform.InstagramBusiness,
    label: "Instagram Business",
    supportsReviews: false,
    supportsHide: true,
    supportsDelete: true,
    supportsReply: true,
  },
  [Platform.YouTube]: {
    platform: Platform.YouTube,
    label: "YouTube",
    supportsReviews: false,
    supportsHide: true,
    supportsDelete: true,
    supportsReply: true,
  },
  [Platform.LinkedInCompany]: {
    platform: Platform.LinkedInCompany,
    label: "LinkedIn Company Page",
    supportsReviews: false,
    supportsHide: false,
    supportsDelete: true,
    supportsReply: true,
  },
  [Platform.TikTok]: {
    platform: Platform.TikTok,
    label: "TikTok",
    supportsReviews: false,
    supportsHide: true,
    supportsDelete: true,
    supportsReply: true,
  },
  [Platform.GoogleBusiness]: {
    platform: Platform.GoogleBusiness,
    label: "Google Business Profile",
    supportsReviews: true,
    supportsHide: false,
    supportsDelete: true,
    supportsReply: true,
  },
};
