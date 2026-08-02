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

// ---- Meta Lead Ads: truthful capability evaluation ---------------------------------------------------------
/**
 * The truthful state of the Meta Lead Ads capability. `available` means EVERY precondition holds (config, plan
 * entitlement, a linked+active account, an active connection, a decryptable vault credential, the granted
 * `leads_retrieval` permission, a VERIFIED Page-level `leadgen` webhook subscription, AND live provider
 * approval). Any other value names the FIRST missing precondition so the UI never claims a capability is
 * available/active when it is not.
 */
export type MetaLeadCapabilityState =
  | "available"
  | "config_missing"
  | "entitlement_locked"
  | "no_linked_account"
  | "connection_inactive"
  | "credential_unavailable"
  | "permission_missing"
  // BUSINESS-LEADGEN-SUBSCRIPTION-V1 — the Page is not subscribed to this app for the `leadgen` field, so Meta
  // delivers NO lead webhooks for it. Everything else can be in place and leads still never arrive.
  | "webhook_subscription_missing"
  | "awaiting_provider_approval";

export interface MetaLeadCapabilitySignals {
  /** Meta app config (id/secret/redirect) is present. */
  metaConfigured: boolean;
  /** The plan entitles the business lead-ingestion capability. */
  entitled: boolean;
  /** A Meta account is linked AND active for this tenant. */
  hasLinkedActiveAccount: boolean;
  /** The business connection itself is in an active state. */
  connectionActive: boolean;
  /** The vault credential for the linked account exists AND decrypts (fail-closed if a row exists but is corrupt). */
  credentialDecryptable: boolean;
  /** The `leads_retrieval` (lead access) permission was actually granted. */
  leadsPermissionGranted: boolean;
  /**
   * The Facebook Page is VERIFIED as subscribed to this Meta app for the `leadgen` webhook field
   * (`/{page-id}/subscribed_apps`). Without it Meta delivers no lead webhooks at all, no matter what else is
   * configured — so provider approval must never stand in for this check.
   */
  pageSubscriptionVerified: boolean;
  /** Meta App Review / provider approval for lead retrieval is in place. */
  providerApproved: boolean;
}

/**
 * Evaluate the truthful capability state. Checks preconditions in a fixed order and returns the FIRST that fails;
 * only when all hold is it `available`. Pure + deterministic — the single source of truth the UI renders.
 */
export function evaluateMetaLeadCapability(s: MetaLeadCapabilitySignals): MetaLeadCapabilityState {
  if (!s.metaConfigured) return "config_missing";
  if (!s.entitled) return "entitlement_locked";
  if (!s.hasLinkedActiveAccount) return "no_linked_account";
  if (!s.connectionActive) return "connection_inactive";
  if (!s.credentialDecryptable) return "credential_unavailable";
  if (!s.leadsPermissionGranted) return "permission_missing";
  // Checked BEFORE provider approval: the Page subscription is the concrete, tenant-fixable precondition, and
  // an approved app still receives nothing without it. `providerApproved` can never substitute for it.
  if (!s.pageSubscriptionVerified) return "webhook_subscription_missing";
  if (!s.providerApproved) return "awaiting_provider_approval";
  return "available";
}

/** True only for the fully-available state — the only state that may present as active/live. */
export function isMetaLeadCapabilityAvailable(state: MetaLeadCapabilityState): boolean {
  return state === "available";
}

// ---- Meta Lead Ads: PER-PAGE readiness --------------------------------------------------------------------
/**
 * BUSINESS-LEADGEN-MULTIPAGE-V1 — Lead Ads readiness is a property of ONE Facebook Page, not of a tenant. A
 * tenant may connect several Pages, each with its own granted permissions, vault credential and Page-level
 * `leadgen` webhook subscription. Collapsing them onto a single "latest" account makes the UI claim a state
 * that is false for every other Page.
 *
 * The canonical precedence order, most severe first. `evaluateMetaLeadCapability` returns the FIRST unmet
 * precondition, and this array is the same order — it is used to fold many Pages into one truthful headline
 * without re-implementing the decision.
 */
export const META_LEAD_STATE_PRECEDENCE: readonly MetaLeadCapabilityState[] = [
  "config_missing",
  "entitlement_locked",
  "no_linked_account",
  "connection_inactive",
  "credential_unavailable",
  "permission_missing",
  "webhook_subscription_missing",
  "awaiting_provider_approval",
  "available",
];

/** Signals shared by every Page of a tenant (deployment config + plan + provider approval). */
export interface MetaLeadTenantSignals {
  metaConfigured: boolean;
  entitled: boolean;
  providerApproved: boolean;
}

/**
 * The per-Page signals. One record per ACTIVE `facebook_page` connected account — an Instagram account is
 * never a Lead Ads subject and must never appear here.
 */
export interface MetaLeadPageSignals {
  /** Internal connected-account id (never a provider/Page id). */
  connectedAccountId: string;
  /** The display name already stored for the account. */
  displayName: string | null;
  connectionActive: boolean;
  credentialDecryptable: boolean;
  leadsPermissionGranted: boolean;
  pageSubscriptionVerified: boolean;
  /** When the Page-level subscription was last checked. Null when never checked. */
  subscriptionCheckedAt: Date | null;
}

/** The safe readiness record rendered per Page. Carries NO provider id, token, secret or PII. */
export interface MetaLeadPageReadiness {
  connectedAccountId: string;
  displayName: string | null;
  leadsPermissionGranted: boolean;
  credentialAvailable: boolean;
  subscriptionVerified: boolean;
  subscriptionCheckedAt: Date | null;
  state: MetaLeadCapabilityState;
  /** True only when `state === "available"` — the only state that may present as active/live. */
  ready: boolean;
}

/**
 * Evaluate ONE Page against the tenant-wide signals. Delegates to {@link evaluateMetaLeadCapability} so the
 * fail-closed precedence is preserved by construction rather than duplicated.
 */
export function evaluateMetaLeadPageReadiness(
  tenant: MetaLeadTenantSignals,
  page: MetaLeadPageSignals,
): MetaLeadPageReadiness {
  const state = evaluateMetaLeadCapability({
    metaConfigured: tenant.metaConfigured,
    entitled: tenant.entitled,
    // This record exists only because an active Page account was found.
    hasLinkedActiveAccount: true,
    connectionActive: page.connectionActive,
    credentialDecryptable: page.credentialDecryptable,
    leadsPermissionGranted: page.leadsPermissionGranted,
    pageSubscriptionVerified: page.pageSubscriptionVerified,
    providerApproved: tenant.providerApproved,
  });
  return {
    connectedAccountId: page.connectedAccountId,
    displayName: page.displayName,
    leadsPermissionGranted: page.leadsPermissionGranted,
    credentialAvailable: page.credentialDecryptable,
    subscriptionVerified: page.pageSubscriptionVerified,
    subscriptionCheckedAt: page.subscriptionCheckedAt,
    state,
    ready: isMetaLeadCapabilityAvailable(state),
  };
}

/** The truthful multi-Page rollup rendered above the per-Page list. */
export interface MetaLeadReadinessSummary {
  /** One record per active Facebook Page, in the order supplied by the caller. */
  pages: MetaLeadPageReadiness[];
  /** Pages whose state is `available`. */
  readyCount: number;
  /** Total active Facebook Pages. */
  totalCount: number;
  /**
   * The single headline state. `available` ONLY when every Page is ready; otherwise the MOST SEVERE unmet
   * precondition across all Pages (lowest precedence index), so the headline can never over-claim. With no
   * Pages at all it falls back to the tenant-level evaluation (config / entitlement / no_linked_account).
   */
  overall: MetaLeadCapabilityState;
}

/**
 * Fold per-Page readiness into a truthful summary. Deterministic and ORDER-INDEPENDENT: the headline is chosen
 * by precedence rank, never by array position, so re-sorting the accounts cannot change the reported state.
 */
export function summarizeMetaLeadReadiness(
  tenant: MetaLeadTenantSignals,
  pages: readonly MetaLeadPageSignals[],
): MetaLeadReadinessSummary {
  const evaluated = pages.map((p) => evaluateMetaLeadPageReadiness(tenant, p));
  if (evaluated.length === 0) {
    return {
      pages: [],
      readyCount: 0,
      totalCount: 0,
      overall: evaluateMetaLeadCapability({
        metaConfigured: tenant.metaConfigured,
        entitled: tenant.entitled,
        hasLinkedActiveAccount: false,
        connectionActive: false,
        credentialDecryptable: false,
        leadsPermissionGranted: false,
        pageSubscriptionVerified: false,
        providerApproved: tenant.providerApproved,
      }),
    };
  }
  const rank = (s: MetaLeadCapabilityState) => META_LEAD_STATE_PRECEDENCE.indexOf(s);
  const overall = evaluated.reduce<MetaLeadCapabilityState>(
    (worst, p) => (rank(p.state) < rank(worst) ? p.state : worst),
    "available",
  );
  return {
    pages: evaluated,
    readyCount: evaluated.filter((p) => p.ready).length,
    totalCount: evaluated.length,
    overall,
  };
}
