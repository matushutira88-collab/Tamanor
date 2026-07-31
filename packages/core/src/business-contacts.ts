/**
 * BUSINESS — CONNECTED PLATFORMS & CONTACTS FOUNDATION V1 (pure domain).
 *
 * Hand-mirrors the Prisma enums (packages/db/prisma/schema.prisma) — matching string values — plus the pure,
 * deterministic domain rules: the truthful provider capability catalogue, source→provider mapping, and the
 * allowed contact status transitions. No I/O, no secrets, no PII. This is the single source of truth the DB
 * repo, server actions, and UI all consume (values cast to the Prisma enum at the DB boundary).
 *
 * TRUTHFULNESS: no provider has a live integration in this checkpoint (no credentials / provider approval /
 * secure credential store). Every provider's default availability is "awaiting_provider_approval" — the UI must
 * render that honestly and never a fake "connected" state.
 */

// ---- Enums (mirror schema string values) -------------------------------------------------------------------
export enum BusinessProvider {
  Meta = "meta",
  Google = "google",
  TikTok = "tiktok",
  LinkedIn = "linkedin",
}
export const ALL_BUSINESS_PROVIDERS: readonly BusinessProvider[] = [
  BusinessProvider.Meta, BusinessProvider.Google, BusinessProvider.TikTok, BusinessProvider.LinkedIn,
];

export enum BusinessConnectionStatus {
  NotConfigured = "not_configured",
  Pending = "pending",
  Active = "active",
  ReauthRequired = "reauth_required",
  Disconnected = "disconnected",
  Error = "error",
  AwaitingProviderApproval = "awaiting_provider_approval",
}

export enum BusinessConnectionCapability {
  LeadIngestion = "lead_ingestion",
  CommentModeration = "comment_moderation",
  BrandMonitoring = "brand_monitoring",
}

export enum BusinessContactSource {
  Facebook = "facebook",
  Instagram = "instagram",
  GoogleAds = "google_ads",
  YouTube = "youtube",
  TikTok = "tiktok",
  LinkedIn = "linkedin",
  WebForm = "web_form",
}

export enum BusinessContactStatus {
  New = "new",
  Contacted = "contacted",
  Handled = "handled",
  Customer = "customer",
  Rejected = "rejected",
}
export const ALL_BUSINESS_CONTACT_STATUSES: readonly BusinessContactStatus[] = [
  BusinessContactStatus.New, BusinessContactStatus.Contacted, BusinessContactStatus.Handled,
  BusinessContactStatus.Customer, BusinessContactStatus.Rejected,
];

export enum BusinessIngestionResult {
  Accepted = "accepted",
  Duplicate = "duplicate",
  Rejected = "rejected",
  InvalidSignature = "invalid_signature",
  InvalidPayload = "invalid_payload",
  UnmappedConnection = "unmapped_connection",
}

// ---- Source ↔ provider mapping -----------------------------------------------------------------------------
/**
 * Which provider a source platform is ingested through. NOTE (per product spec): YouTube-advertising contacts
 * are technically ingested through the Google Ads lead source, so YouTube maps to the GOOGLE provider (YouTube
 * comment moderation is a separate capability of the same Google connection). WEB_FORM has no external provider.
 */
export const SOURCE_PROVIDER: Record<BusinessContactSource, BusinessProvider | null> = {
  [BusinessContactSource.Facebook]: BusinessProvider.Meta,
  [BusinessContactSource.Instagram]: BusinessProvider.Meta,
  [BusinessContactSource.GoogleAds]: BusinessProvider.Google,
  [BusinessContactSource.YouTube]: BusinessProvider.Google,
  [BusinessContactSource.TikTok]: BusinessProvider.TikTok,
  [BusinessContactSource.LinkedIn]: BusinessProvider.LinkedIn,
  [BusinessContactSource.WebForm]: null,
};

/** Provider → the source platforms it can attribute (used for validation + the platform card copy). */
export function sourcesForProvider(provider: BusinessProvider): BusinessContactSource[] {
  return (Object.keys(SOURCE_PROVIDER) as BusinessContactSource[]).filter((s) => SOURCE_PROVIDER[s] === provider);
}

// ---- Provider capability catalogue (truthful availability) --------------------------------------------------
export interface BusinessProviderInfo {
  provider: BusinessProvider;
  /** Capabilities this provider CAN offer once genuinely connected (declaration, not activation). */
  declaredCapabilities: readonly BusinessConnectionCapability[];
  /** The truthful default status for a tenant with no connection row yet in THIS checkpoint. */
  defaultStatus: BusinessConnectionStatus;
  /** True only when a live connect/reconnect/disconnect flow is genuinely implemented. All false here. */
  connectImplemented: boolean;
}

/**
 * The catalogue. `connectImplemented=false` and `defaultStatus=awaiting_provider_approval` for EVERY provider —
 * there is no live OAuth, credential store, or provider approval in this checkpoint. The UI derives its truthful
 * disabled state from this; it must never render a connect button that does nothing or a fake "connected" card.
 */
export const BUSINESS_PROVIDER_CATALOGUE: Record<BusinessProvider, BusinessProviderInfo> = {
  [BusinessProvider.Meta]: {
    provider: BusinessProvider.Meta,
    declaredCapabilities: [BusinessConnectionCapability.LeadIngestion, BusinessConnectionCapability.CommentModeration, BusinessConnectionCapability.BrandMonitoring],
    defaultStatus: BusinessConnectionStatus.AwaitingProviderApproval,
    connectImplemented: false,
  },
  [BusinessProvider.Google]: {
    provider: BusinessProvider.Google,
    declaredCapabilities: [BusinessConnectionCapability.LeadIngestion, BusinessConnectionCapability.CommentModeration],
    defaultStatus: BusinessConnectionStatus.AwaitingProviderApproval,
    connectImplemented: false,
  },
  [BusinessProvider.TikTok]: {
    provider: BusinessProvider.TikTok,
    declaredCapabilities: [BusinessConnectionCapability.LeadIngestion],
    defaultStatus: BusinessConnectionStatus.AwaitingProviderApproval,
    connectImplemented: false,
  },
  [BusinessProvider.LinkedIn]: {
    provider: BusinessProvider.LinkedIn,
    declaredCapabilities: [BusinessConnectionCapability.LeadIngestion],
    defaultStatus: BusinessConnectionStatus.AwaitingProviderApproval,
    connectImplemented: false,
  },
};

/** A status is "connected/serving" only when genuinely active. Everything else is a non-active truthful state. */
export function isBusinessConnectionActive(status: BusinessConnectionStatus): boolean {
  return status === BusinessConnectionStatus.Active;
}

// ---- Contact status transitions ----------------------------------------------------------------------------
/**
 * Allowed status transitions for a Business contact. Deliberately permissive within the pipeline (a handler can
 * correct a mistaken status) but bounded to the fixed enum; a "rejected"/"customer" terminal can still be
 * reopened to an earlier stage. Same-status is a no-op (idempotent), handled by the caller.
 */
const CONTACT_TRANSITIONS: Record<BusinessContactStatus, readonly BusinessContactStatus[]> = {
  [BusinessContactStatus.New]: [BusinessContactStatus.Contacted, BusinessContactStatus.Handled, BusinessContactStatus.Customer, BusinessContactStatus.Rejected],
  [BusinessContactStatus.Contacted]: [BusinessContactStatus.New, BusinessContactStatus.Handled, BusinessContactStatus.Customer, BusinessContactStatus.Rejected],
  [BusinessContactStatus.Handled]: [BusinessContactStatus.Contacted, BusinessContactStatus.Customer, BusinessContactStatus.Rejected, BusinessContactStatus.New],
  [BusinessContactStatus.Customer]: [BusinessContactStatus.Handled, BusinessContactStatus.Rejected, BusinessContactStatus.Contacted],
  [BusinessContactStatus.Rejected]: [BusinessContactStatus.New, BusinessContactStatus.Contacted],
};

export function isValidContactStatus(v: unknown): v is BusinessContactStatus {
  return typeof v === "string" && (ALL_BUSINESS_CONTACT_STATUSES as string[]).includes(v);
}

/** True when moving from → to is allowed. A same-status move is allowed (idempotent no-op at the repo). */
export function canTransitionContactStatus(from: BusinessContactStatus, to: BusinessContactStatus): boolean {
  if (from === to) return true;
  return (CONTACT_TRANSITIONS[from] ?? []).includes(to);
}

// ---- Deterministic dedupe identity -------------------------------------------------------------------------
/**
 * Build the deterministic dedupe seed (NOT hashed here — the repo hashes it). Uses the stable external lead id
 * when present; otherwise a bounded composite of source + campaign/form + a caller-supplied content fingerprint.
 * Never includes raw PII beyond what the provider already keys on.
 */
export function businessContactDedupeSeed(input: {
  provider: BusinessProvider;
  source: BusinessContactSource;
  externalLeadId?: string | null;
  formId?: string | null;
  contentFingerprint?: string | null;
}): string {
  const parts = [
    input.provider,
    input.source,
    input.externalLeadId?.trim() || `noid:${input.formId?.trim() ?? ""}:${input.contentFingerprint?.trim() ?? ""}`,
  ];
  return parts.join("|");
}
