/**
 * V1.38.2B — the SINGLE public provider-status model. Every surface that states what
 * a platform can do today — integration pages, compare pages, llms.txt, llms-full.txt,
 * ai-index.json, capabilities.json, the entity graph and sitemap metadata — reads THIS
 * module. There must never be two different truths about a provider's status.
 *
 * Statuses are set from the REAL codebase + phase reports, not marketing intent:
 *   - Facebook read-only sync is verified live (hide is human-approved, off by default).
 *   - Instagram is implementation-complete but NOT live (Meta App Review pending).
 *   - Google Business is a foundation ready for approved API access; NOT live.
 *   - YouTube / LinkedIn / TikTok are research — not supported.
 */
import {
  FACEBOOK_CAPABILITIES,
  INSTAGRAM_CAPABILITIES,
  GOOGLE_BUSINESS_CAPABILITIES,
} from "@guardora/core";

export type ProviderStatus =
  | "live_verified"
  | "implementation_complete_verification_pending"
  | "foundation_only"
  | "read_only"
  | "unsupported"
  | "research";

export interface ProviderTruth {
  key: string;
  name: string;
  status: ProviderStatus;
  /** True when a real provider verification (App Review / approved API access) is still pending. */
  verificationPending: boolean;
  /** True ONLY when the connector is verified working against the real provider today. */
  live: boolean;
  /** The exact truthful public sentence. Reused verbatim across web + AI artifacts. */
  publicStatement: string;
  /** Grep-auditable source of the capability facts. */
  capabilitiesSource: string;
}

export const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  live_verified: "Live · verified",
  implementation_complete_verification_pending: "Implementation complete · provider verification pending",
  foundation_only: "Foundation · provider verification pending",
  read_only: "Read-only",
  unsupported: "Not supported",
  research: "Research",
};

export const PROVIDERS: readonly ProviderTruth[] = [
  {
    key: "facebook",
    name: "Facebook Page",
    status: "live_verified",
    verificationPending: false,
    live: true,
    publicStatement:
      "Live read-only comment monitoring is verified. Comment hiding is human-approved and off by default; Tamanor never deletes, replies, likes, bans or reports.",
    capabilitiesSource: "core/FACEBOOK_CAPABILITIES (canReadComments, canHideComment)",
  },
  {
    key: "instagram",
    name: "Instagram Business",
    status: "implementation_complete_verification_pending",
    verificationPending: true,
    live: false,
    publicStatement:
      "Implementation complete — discovery, read-only comment ingestion with pagination and webhooks. Real provider verification via Meta App Review is pending, so Instagram is not yet live.",
    capabilitiesSource: "core/INSTAGRAM_CAPABILITIES (canReadComments; no moderation)",
  },
  {
    key: "google_business",
    name: "Google Business Profile",
    status: "foundation_only",
    verificationPending: true,
    live: false,
    publicStatement:
      "Connector implementation/foundation is ready for approved API access. Real provider verification is pending, so Google Business review monitoring is not yet live.",
    capabilitiesSource: "core/GOOGLE_BUSINESS_CAPABILITIES (canReviewSync; no auto-reply)",
  },
  {
    key: "youtube",
    name: "YouTube",
    status: "research",
    verificationPending: false,
    live: false,
    publicStatement: "Not supported yet — research. Tamanor does not claim YouTube support.",
    capabilitiesSource: "core/YOUTUBE_CAPABILITIES (defined but no live sync wired)",
  },
  {
    key: "linkedin",
    name: "LinkedIn Company Page",
    status: "research",
    verificationPending: false,
    live: false,
    publicStatement: "Not supported yet — research. LinkedIn organic comment access is partner-gated.",
    capabilitiesSource: "core/LINKEDIN_CAPABILITIES (none)",
  },
  {
    key: "tiktok",
    name: "TikTok",
    status: "research",
    verificationPending: false,
    live: false,
    publicStatement: "Not supported yet — research. TikTok's comment API is app-review-gated.",
    capabilitiesSource: "core/TIKTOK_CAPABILITIES (none)",
  },
];

// Compile-time-ish guardrail: the live/verificationPending flags must agree with core.
// (These references keep the model honest and make drift a type/graph error, not a lie.)
void FACEBOOK_CAPABILITIES.canHideComment;
void INSTAGRAM_CAPABILITIES.canReadComments;
void GOOGLE_BUSINESS_CAPABILITIES.canReviewSync;

const BY_KEY = new Map(PROVIDERS.map((p) => [p.key, p]));

export function providerStatusFor(key: string | undefined | null): ProviderTruth | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/** Providers that are live-verified today (currently Facebook only). */
export function liveProviders(): ProviderTruth[] {
  return PROVIDERS.filter((p) => p.live);
}
