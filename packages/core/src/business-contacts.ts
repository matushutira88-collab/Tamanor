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

// ---- Meta connect: server-side asset selection validation -------------------------------------------------
/**
 * BUSINESS-LEADGEN-ONBOARDING-V1 — the assets discovered for THIS authenticated OAuth flow, as persisted
 * server-side. The selection form is validated against this list; a client may only ever narrow it.
 */
export interface MetaSelectableAsset {
  pageId: string;
  igBusinessId?: string | null;
}

/** The validated selection. Ids present here are guaranteed to come from the SERVER asset list. */
export interface MetaAssetSelection {
  /** Facebook Page ids the user selected, all present in the server asset list. */
  pages: ReadonlySet<string>;
  /** Instagram business ids the user selected, all linked to a server-listed Page. */
  instagram: ReadonlySet<string>;
  /** How many submitted values did NOT match any server-side asset (ignored, never acted on). */
  rejected: number;
}

/**
 * Validate the raw `select` values (`facebook:<id>` / `instagram:<id>`) against the SERVER-side asset list
 * discovered during the authenticated OAuth flow. Anything that does not match a discovered asset — an
 * unowned Page id, another tenant's id, a malformed value, an unknown prefix — is counted as rejected and
 * NEVER acted on. Pure: no I/O, no provider call, no credential access.
 */
export function resolveMetaAssetSelection(
  serverAssets: readonly MetaSelectableAsset[],
  rawSelected: readonly string[],
): MetaAssetSelection {
  const knownPages = new Set(serverAssets.map((a) => a.pageId).filter(Boolean));
  const knownIg = new Set(serverAssets.map((a) => a.igBusinessId).filter((v): v is string => Boolean(v)));
  const pages = new Set<string>();
  const instagram = new Set<string>();
  let rejected = 0;
  for (const raw of rawSelected) {
    const value = typeof raw === "string" ? raw : "";
    const sep = value.indexOf(":");
    const kind = sep > 0 ? value.slice(0, sep) : "";
    const id = sep > 0 ? value.slice(sep + 1) : "";
    if (kind === "facebook" && knownPages.has(id)) pages.add(id);
    else if (kind === "instagram" && knownIg.has(id)) instagram.add(id);
    else rejected++;
  }
  return { pages, instagram, rejected };
}

// ---- Meta connect: per-Page onboarding outcome ------------------------------------------------------------
/**
 * The truthful result of onboarding ONE Facebook Page. Bounded enum — safe for ops labels and for a redirect
 * summary. Carries no identifier of any kind.
 */
export type MetaPageOnboardingOutcome =
  /** Connected AND the Lead Ads webhook subscription is verified AND every other precondition holds. */
  | "lead_ads_ready"
  /** Connected; the deployment asks for lead access but this Page does not carry `leads_retrieval`. */
  | "leads_permission_missing"
  /** Connected; the Page-level `leadgen` subscription could not be verified. RECOVERABLE via the repair action. */
  | "webhook_not_verified"
  /** Connected + subscribed, but live Meta App Review for lead retrieval is not in place. */
  | "provider_approval_required"
  /** Connected for comment monitoring only — this deployment does not request lead access at all. */
  | "comments_only"
  /** The provider check failed transiently; the real subscription state is UNKNOWN, never assumed OK. */
  | "verification_unavailable";

/** Fixed order — also the encoding order of the onboarding summary. */
export const ALL_META_PAGE_ONBOARDING_OUTCOMES: readonly MetaPageOnboardingOutcome[] = [
  "lead_ads_ready",
  "leads_permission_missing",
  "webhook_not_verified",
  "provider_approval_required",
  "comments_only",
  "verification_unavailable",
];

export interface MetaPageOnboardingSignals {
  /**
   * This deployment requests lead access in its OAuth scopes. When false the Page is a comment-monitoring
   * connection and Lead Ads simply does not apply.
   */
  leadsScopeRequested: boolean;
  /** `leads_retrieval` is present on the Page account's stored permissions. */
  leadsPermissionGranted: boolean;
  /** The persisted Page-level subscription status after the connect attempt (null = never checked). */
  subscriptionStatus: "verified" | "not_subscribed" | "unavailable" | null;
  /** Live Meta App Review / provider approval for lead retrieval is in place. */
  providerApproved: boolean;
}

/**
 * Classify one Page's onboarding result. Fail-closed and ordered so the FIRST genuine gap is reported:
 * a Page is only `lead_ads_ready` when lead access is requested, granted, the subscription is VERIFIED, and
 * provider approval is in place. An `unavailable` provider check is never reported as ready or as a definite
 * failure — it is reported as unknown.
 */
export function classifyMetaPageOnboarding(s: MetaPageOnboardingSignals): MetaPageOnboardingOutcome {
  if (!s.leadsScopeRequested) return "comments_only";
  if (!s.leadsPermissionGranted) return "leads_permission_missing";
  if (s.subscriptionStatus === "unavailable") return "verification_unavailable";
  if (s.subscriptionStatus !== "verified") return "webhook_not_verified";
  if (!s.providerApproved) return "provider_approval_required";
  return "lead_ads_ready";
}

/** Counts per outcome across every Page processed by one connect/reconnect. */
export interface MetaOnboardingSummary {
  total: number;
  counts: Record<MetaPageOnboardingOutcome, number>;
}

export function summarizeMetaPageOnboarding(outcomes: readonly MetaPageOnboardingOutcome[]): MetaOnboardingSummary {
  const counts = Object.fromEntries(ALL_META_PAGE_ONBOARDING_OUTCOMES.map((o) => [o, 0])) as Record<MetaPageOnboardingOutcome, number>;
  for (const o of outcomes) if (o in counts) counts[o]++;
  return { total: outcomes.length, counts };
}

/** Per-outcome count cap — keeps the encoded summary bounded and the URL short. */
const ONBOARDING_COUNT_MAX = 999;

/**
 * Encode the summary for a redirect. Fixed-order, dot-separated COUNTS ONLY — no Page name, provider id,
 * account id, tenant id, token or any other identifier ever enters the URL.
 */
export function encodeMetaOnboardingSummary(summary: MetaOnboardingSummary): string {
  return ALL_META_PAGE_ONBOARDING_OUTCOMES
    .map((o) => Math.max(0, Math.min(ONBOARDING_COUNT_MAX, Math.trunc(summary.counts[o] ?? 0))))
    .join(".");
}

/**
 * Decode a redirect summary defensively. Any malformed, negative, non-numeric, over-long or over-large input
 * yields null (the notice is simply not rendered) — a hostile query string can never inject content.
 */
export function decodeMetaOnboardingSummary(raw: string | null | undefined): MetaOnboardingSummary | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 32) return null;
  const parts = raw.split(".");
  if (parts.length !== ALL_META_PAGE_ONBOARDING_OUTCOMES.length) return null;
  const counts = Object.fromEntries(ALL_META_PAGE_ONBOARDING_OUTCOMES.map((o) => [o, 0])) as Record<MetaPageOnboardingOutcome, number>;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!/^\d{1,3}$/.test(parts[i]!)) return null;
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > ONBOARDING_COUNT_MAX) return null;
    counts[ALL_META_PAGE_ONBOARDING_OUTCOMES[i]!] = n;
    total += n;
  }
  return total === 0 ? null : { total, counts };
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

// ---- CRM V2 Phase A: contact search, notes, activity timeline ---------------------------------------------
/** Minimum meaningful search length — a 1-character query matches almost everything and is rejected. */
export const CONTACT_SEARCH_MIN_LENGTH = 2;
/** Hard upper bound on a search query. Anything longer is truncated before it reaches the database. */
export const CONTACT_SEARCH_MAX_LENGTH = 100;

/**
 * Normalize a raw `q=` search value into a bounded, safe term — or null when it is not meaningful.
 *
 * Pure and defensive: strips control characters, collapses whitespace, truncates to
 * {@link CONTACT_SEARCH_MAX_LENGTH}, and returns null below {@link CONTACT_SEARCH_MIN_LENGTH}. It performs NO
 * SQL escaping — the repository passes the result to Prisma as a BOUND PARAMETER, never string interpolation —
 * and it is not an output sanitizer; React escapes what it renders.
 */
export function normalizeContactSearch(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < CONTACT_SEARCH_MIN_LENGTH) return null;
  return cleaned.slice(0, CONTACT_SEARCH_MAX_LENGTH);
}

/**
 * The digits-only form of a search term, used for phone matching when the term looks like a phone fragment.
 * Returns null unless the term is phone-shaped (digits plus the usual separators) and still carries enough
 * digits to be selective — so a name like "Anna" never becomes a phone probe.
 */
export function contactSearchPhoneDigits(term: string): string | null {
  if (!/^[+\d][\d\s().+-]*$/.test(term)) return null;
  const digits = term.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

/** Maximum stored length of one internal note body. */
export const CONTACT_NOTE_MAX_LENGTH = 2000;

export type ContactNoteValidation =
  | { ok: true; body: string }
  | { ok: false; reason: "empty" | "too_long" };

/**
 * Validate + normalize an internal note body. PLAIN TEXT ONLY — no HTML, Markdown, file or attachment is ever
 * interpreted; the stored string is rendered as text by React, which escapes it. Control characters other than
 * newline and tab are stripped, CRLF is normalized, surrounding whitespace trimmed. The length bound is applied
 * AFTER normalization so padding cannot smuggle a longer body past it.
 */
export function validateContactNoteBody(raw: string | null | undefined): ContactNoteValidation {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (cleaned.length === 0) return { ok: false, reason: "empty" };
  if (cleaned.length > CONTACT_NOTE_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, body: cleaned };
}

/** The kinds of event the contact timeline renders. Bounded — never a free-form audit event name. */
export type ContactTimelineKind =
  | "received" | "status_changed" | "assignment_changed" | "note"
  // Phase C — privacy lifecycle events, sourced from the SAME existing audit ledger.
  | "archived" | "unarchived" | "marked_spam" | "spam_restored" | "anonymized";

export interface ContactTimelineEntry {
  kind: ContactTimelineKind;
  at: Date;
  /** Safe display value for the actor (a tenant-member email) or null. Never a raw user id. */
  actor: string | null;
  /** Bounded status enum for `status_changed`. */
  status?: BusinessContactStatus;
  /** Whether the contact ended up assigned, for `assignment_changed`. Never a user id. */
  assigned?: boolean;
  /** The note's own stored body — the ONLY timeline field carrying free text. Absent once redacted. */
  body?: string;
  /** True for a note whose body was irreversibly cleared by anonymization. */
  redacted?: boolean;
}

/** The audit events this timeline understands. Anything else in the ledger is ignored. */
export const CONTACT_STATUS_AUDIT_EVENT = "business_contact.status_changed";
export const CONTACT_ASSIGNMENT_AUDIT_EVENT = "business_contact.assignment_changed";
export const CONTACT_NOTE_AUDIT_EVENT = "business_contact.note_added";
/** Phase C privacy events → timeline kinds. Bounded; anything else in the ledger is ignored. */
export const CONTACT_LIFECYCLE_AUDIT_EVENTS: Readonly<Record<string, ContactTimelineKind>> = {
  "business_contact.archived": "archived",
  "business_contact.unarchived": "unarchived",
  "business_contact.marked_spam": "marked_spam",
  "business_contact.spam_restored": "spam_restored",
  "business_contact.anonymized": "anonymized",
};

export interface ContactAuditRecord {
  event: string;
  createdAt: Date;
  actorUserId: string | null;
  /** Already-PII-free audit metadata: `{ to }` for status, `{ assigned }` for assignment. */
  metadata?: { to?: unknown; assigned?: unknown } | null;
}
export interface ContactNoteRecord {
  createdAt: Date;
  authorUserId: string | null;
  /** Null once the parent contact was anonymized — the body was irreversibly cleared, not moved. */
  body: string | null;
  redactedAt?: Date | null;
}

/**
 * Build the chronological contact timeline from the contact's own `receivedAt`, the EXISTING tenant-scoped
 * audit ledger, and the contact's notes. Pure — no I/O.
 *
 * Ordering is ASCENDING (oldest first) and deterministic: equal timestamps break by a fixed kind rank, so the
 * same inputs always render in the same order. Actor ids resolve through the supplied display map (a
 * tenant-member email); an id with no mapping renders as null rather than leaking a raw user id. A
 * `note_added` audit row is skipped — the note itself is the entry, so the audit row would duplicate it.
 */
export function buildContactTimeline(input: {
  receivedAt: Date;
  audit: readonly ContactAuditRecord[];
  notes: readonly ContactNoteRecord[];
  /** userId → safe display value (tenant-member email). Ids absent from the map render as null. */
  actorDisplay?: Readonly<Record<string, string>>;
  /** Strict maximum entries returned (most recent kept, still rendered oldest-first). */
  limit?: number;
}): ContactTimelineEntry[] {
  const display = (id: string | null): string | null => (id ? input.actorDisplay?.[id] ?? null : null);
  const entries: ContactTimelineEntry[] = [{ kind: "received", at: input.receivedAt, actor: null }];

  for (const a of input.audit) {
    if (a.event === CONTACT_STATUS_AUDIT_EVENT) {
      const to = typeof a.metadata?.to === "string" && isValidContactStatus(a.metadata.to)
        ? (a.metadata.to as BusinessContactStatus) : undefined;
      entries.push({ kind: "status_changed", at: a.createdAt, actor: display(a.actorUserId), ...(to ? { status: to } : {}) });
    } else if (a.event === CONTACT_ASSIGNMENT_AUDIT_EVENT) {
      entries.push({ kind: "assignment_changed", at: a.createdAt, actor: display(a.actorUserId), assigned: a.metadata?.assigned === true });
    }
    else if (CONTACT_LIFECYCLE_AUDIT_EVENTS[a.event]) {
      entries.push({ kind: CONTACT_LIFECYCLE_AUDIT_EVENTS[a.event]!, at: a.createdAt, actor: display(a.actorUserId) });
    }
    // CONTACT_NOTE_AUDIT_EVENT is intentionally ignored — the note row itself is the entry.
  }
  for (const n of input.notes) {
    // A redacted note keeps its place in the history (who wrote one, and when) but carries no text: the body
    // was cleared by anonymization and exists nowhere else.
    entries.push({
      kind: "note", at: n.createdAt, actor: display(n.authorUserId),
      ...(typeof n.body === "string" ? { body: n.body } : { redacted: true }),
    });
  }

  const rank: Record<ContactTimelineKind, number> = {
    received: 0, status_changed: 1, assignment_changed: 2, note: 3,
    archived: 4, unarchived: 5, marked_spam: 6, spam_restored: 7, anonymized: 8,
  };
  entries.sort((a, b) => a.at.getTime() - b.at.getTime() || rank[a.kind] - rank[b.kind]);
  const limit = input.limit;
  return typeof limit === "number" && limit > 0 && entries.length > limit ? entries.slice(entries.length - limit) : entries;
}

// ---- CRM V2 Phase B: bulk selection + bounded CSV export --------------------------------------------------
/** Hard cap on contacts in one bulk request. The browser submits ids; anything beyond this is rejected. */
export const MAX_BULK_CONTACT_IDS = 100;

export type BulkSelectionRejection = "empty" | "too_many" | "invalid";

export type BulkSelectionResult =
  | { ok: true; ids: string[]; duplicatesDropped: number }
  | { ok: false; reason: BulkSelectionRejection };

/**
 * Normalize a raw list of submitted contact ids into a bounded, de-duplicated selection.
 *
 * Deterministic and fail-closed: ids are trimmed, shape-validated (cuid-like — the only id form this system
 * mints), de-duplicated preserving first-seen order, and the result must be non-empty and within
 * {@link MAX_BULK_CONTACT_IDS}. De-duplication happens BEFORE the cap so re-sending the same id cannot consume
 * the budget. A malformed id rejects the whole request rather than being silently dropped — a client that
 * submits garbage should be told, not partially obeyed.
 *
 * This validates SHAPE only. Whether an id belongs to the caller's tenant is decided later, under RLS.
 */
export function normalizeBulkContactIds(raw: readonly unknown[] | null | undefined): BulkSelectionResult {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: "empty" };
  const seen = new Set<string>();
  const ids: string[] = [];
  let duplicatesDropped = 0;
  for (const value of raw) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id) return { ok: false, reason: "invalid" };
    // The only id shape this system mints (cuid): lowercase alphanumeric, bounded.
    if (!/^[a-z0-9]{16,40}$/.test(id)) return { ok: false, reason: "invalid" };
    if (seen.has(id)) { duplicatesDropped++; continue; }
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return { ok: false, reason: "empty" };
  if (ids.length > MAX_BULK_CONTACT_IDS) return { ok: false, reason: "too_many" };
  return { ok: true, ids, duplicatesDropped };
}

/** Bounded reason one contact in a bulk operation did not change. Never carries an id or PII. */
export type BulkContactFailureReason = "not_found" | "invalid_transition";

export interface BulkContactOutcome {
  /** Ids that genuinely changed — used only server-side, never surfaced in a redirect or audit. */
  changed: string[];
  /** Per-id failures, kept server-side. Counts are what reaches the UI and audit. */
  failed: Array<{ id: string; reason: BulkContactFailureReason }>;
}

/** The bounded, id-free summary of a bulk operation — the only shape allowed in a redirect, UI or audit. */
export interface BulkContactSummary {
  affected: number;
  failed: number;
}
export function summarizeBulkContacts(outcome: BulkContactOutcome): BulkContactSummary {
  return { affected: outcome.changed.length, failed: outcome.failed.length };
}

/** Maximum rows one CSV export may contain. A larger result set is truncated and reported as limited. */
export const CONTACT_EXPORT_MAX_ROWS = 10_000;

/**
 * The STABLE export column order. Changing this is a breaking change for anyone with a saved spreadsheet, so
 * columns are appended, never reordered or removed.
 *
 * Deliberately ABSENT: the internal contact id, tenant id, connection id, provider ids, external lead id,
 * dedupe key, notes, raw audit metadata, consent internals (reference/version) and anything Meta-specific.
 */
export const CONTACT_EXPORT_COLUMNS = [
  "full_name",
  "email",
  "phone",
  "company",
  "source",
  "campaign_name",
  "form_name",
  "received_at",
  "status",
  "assigned_to",
  "latest_activity_at",
] as const;
export type ContactExportColumn = typeof CONTACT_EXPORT_COLUMNS[number];

/** One contact as the exporter sees it. Only already-safe, user-facing values. */
export interface ContactExportSource {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  sourcePlatform: BusinessContactSource;
  campaignName: string | null;
  formName: string | null;
  receivedAt: Date;
  status: BusinessContactStatus;
  /** Resolved tenant-member display value, or null when unassigned / not resolvable. Never a raw user id. */
  assignedTo: string | null;
  latestActivityAt: Date;
  /**
   * Phase C — privacy lifecycle. An `anonymized` row is exported as a generic tombstone instead of this record,
   * so no personal or provider value can reach the file.
   */
  lifecycleState?: BusinessContactLifecycle;
}

/**
 * Map one contact to its export row, in {@link CONTACT_EXPORT_COLUMNS} order.
 *
 * Dates are ISO 8601 UTC — locale-neutral and machine-readable, never a localized string that would differ
 * per viewer. Empty values become "" rather than "null". This performs NO CSV escaping and NO formula
 * neutralization: that is `csvEscapeField`'s job, applied uniformly at serialization so a single guard covers
 * every field. Stored values are never mutated — this only shapes the exported representation.
 */
export function contactExportRow(c: ContactExportSource): string[] {
  const text = (v: string | null): string => v ?? "";
  return [
    text(c.fullName),
    text(c.email),
    text(c.phone),
    text(c.company),
    c.sourcePlatform,
    text(c.campaignName),
    text(c.formName),
    c.receivedAt.toISOString(),
    c.status,
    text(c.assignedTo),
    c.latestActivityAt.toISOString(),
  ];
}

/** Generic, PII-free export filename: `tamanor-contacts-YYYY-MM-DD.csv`. */
export function contactExportFilename(now: Date): string {
  return `tamanor-contacts-${now.toISOString().slice(0, 10)}.csv`;
}

// ---- CRM V2 Phase C: privacy lifecycle, anonymization, retention review -----------------------------------
/**
 * The contact's PRIVACY LIFECYCLE — deliberately separate from the sales `BusinessContactStatus`.
 *
 * Overloading `Rejected` to also mean "spam" or "anonymized" would destroy the sales pipeline's meaning: a
 * rejected lead is a commercial outcome a handler can reopen, whereas spam is junk and anonymization is an
 * irreversible privacy act. They are orthogonal axes and are modelled as such.
 */
export enum BusinessContactLifecycle {
  Active = "active",
  Spam = "spam",
  Archived = "archived",
  Anonymized = "anonymized",
}
export const ALL_BUSINESS_CONTACT_LIFECYCLES: readonly BusinessContactLifecycle[] = [
  BusinessContactLifecycle.Active, BusinessContactLifecycle.Spam,
  BusinessContactLifecycle.Archived, BusinessContactLifecycle.Anonymized,
];
export function isValidContactLifecycle(v: unknown): v is BusinessContactLifecycle {
  return typeof v === "string" && (ALL_BUSINESS_CONTACT_LIFECYCLES as string[]).includes(v);
}

/** Lifecycle states hidden from the default contact list. Spam and archive are opt-in views. */
export const DEFAULT_HIDDEN_LIFECYCLES: readonly BusinessContactLifecycle[] = [
  BusinessContactLifecycle.Spam, BusinessContactLifecycle.Archived, BusinessContactLifecycle.Anonymized,
];

/**
 * Allowed lifecycle transitions. `anonymized` is TERMINAL and has no outgoing edge — an anonymized contact can
 * never return to an identified state, because the identifying data no longer exists to return to. Spam and
 * archive are reversible, but only through their own explicit, audited actions.
 */
const LIFECYCLE_TRANSITIONS: Record<BusinessContactLifecycle, readonly BusinessContactLifecycle[]> = {
  [BusinessContactLifecycle.Active]: [BusinessContactLifecycle.Spam, BusinessContactLifecycle.Archived, BusinessContactLifecycle.Anonymized],
  [BusinessContactLifecycle.Spam]: [BusinessContactLifecycle.Active, BusinessContactLifecycle.Anonymized],
  [BusinessContactLifecycle.Archived]: [BusinessContactLifecycle.Active, BusinessContactLifecycle.Anonymized],
  [BusinessContactLifecycle.Anonymized]: [],
};
export function canTransitionContactLifecycle(from: BusinessContactLifecycle, to: BusinessContactLifecycle): boolean {
  if (from === to) return true; // idempotent no-op at the repository
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * OPTIONAL internal reason categories for an anonymization. A FIXED enum — free text is deliberately not
 * accepted in this phase, because a free-text reason is the most likely place for someone to paste the very
 * personal data the action exists to remove.
 *
 * These are OPERATIONAL bookkeeping labels chosen by the operator. They are NOT legal conclusions, they do not
 * assert a legal basis, and Tamanor does not determine from them whether any deletion is legally required.
 */
export enum ContactAnonymizationReason {
  UserRequest = "user_request",
  RetentionPolicy = "retention_policy",
  TestData = "test_data",
  DuplicateRecord = "duplicate_record",
  OtherInternal = "other_internal",
}
export const ALL_ANONYMIZATION_REASONS: readonly ContactAnonymizationReason[] = [
  ContactAnonymizationReason.UserRequest, ContactAnonymizationReason.RetentionPolicy,
  ContactAnonymizationReason.TestData, ContactAnonymizationReason.DuplicateRecord,
  ContactAnonymizationReason.OtherInternal,
];
export function isValidAnonymizationReason(v: unknown): v is ContactAnonymizationReason {
  return typeof v === "string" && (ALL_ANONYMIZATION_REASONS as string[]).includes(v);
}

/**
 * The bounded confirmation value a manager must type. A deliberate friction step so an irreversible action can
 * never be a single stray click. Compared exactly — never localized, so a translation can never weaken it.
 */
export const CONTACT_ANONYMIZATION_CONFIRMATION = "ANONYMIZE";
export function isAnonymizationConfirmed(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().toUpperCase() === CONTACT_ANONYMIZATION_CONFIRMATION;
}

/** What a contact in a given lifecycle state may still have done to it. Pure — the UI and the server share it. */
export interface ContactActionAvailability {
  canAddNote: boolean;
  canAssign: boolean;
  canChangeStatus: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  canMarkSpam: boolean;
  canRestoreSpam: boolean;
  canAnonymize: boolean;
  canExportIdentifying: boolean;
}

/**
 * An ANONYMIZED contact is a tombstone: notes, assignment, sales status and identifying export are all closed,
 * and there is no restoration path. Spam and archived remain fully workable — hiding a contact from the default
 * view is an organisational act, not a privacy act.
 */
export function contactActionAvailability(lifecycle: BusinessContactLifecycle): ContactActionAvailability {
  const anonymized = lifecycle === BusinessContactLifecycle.Anonymized;
  return {
    canAddNote: !anonymized,
    canAssign: !anonymized,
    canChangeStatus: !anonymized,
    canArchive: lifecycle === BusinessContactLifecycle.Active,
    canUnarchive: lifecycle === BusinessContactLifecycle.Archived,
    canMarkSpam: lifecycle === BusinessContactLifecycle.Active,
    canRestoreSpam: lifecycle === BusinessContactLifecycle.Spam,
    canAnonymize: !anonymized,
    canExportIdentifying: !anonymized,
  };
}

// ---- Retention REVIEW (operational recommendation only — never an automatic decision) ---------------------
/**
 * Bounds for the retention REVIEW threshold. This is an operational reminder window chosen by the operator; it
 * is NOT a legal retention period, Tamanor does not assert that the chosen value is correct for any
 * jurisdiction, and nothing is ever anonymized or deleted automatically because of it.
 */
export const CONTACT_REVIEW_MIN_DAYS = 30;
export const CONTACT_REVIEW_MAX_DAYS = 3650;
/** Safe default when the operator has configured nothing. Two years — a conservative reminder cadence. */
export const CONTACT_REVIEW_DEFAULT_DAYS = 730;

/** Clamp an operator-supplied threshold into the supported range. Non-numeric input falls back to the default. */
export function normalizeReviewThresholdDays(raw: unknown): number {
  // A MISSING value is not "zero days": null, undefined and "" must fall back to the default rather than
  // silently clamping to the 30-day minimum, which would recommend review for almost everything.
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return CONTACT_REVIEW_DEFAULT_DAYS;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return CONTACT_REVIEW_DEFAULT_DAYS;
  return Math.min(CONTACT_REVIEW_MAX_DAYS, Math.max(CONTACT_REVIEW_MIN_DAYS, Math.trunc(n)));
}

/**
 * Whether a contact is RECOMMENDED FOR REVIEW — nothing stronger. The wording matters: this says a human may
 * want to look, never that the record must be deleted.
 *
 * A contact qualifies when it is not already anonymized and its most recent signal (the later of `receivedAt`
 * and any later activity) is older than the threshold. Pure and deterministic.
 */
export function contactNeedsPrivacyReview(input: {
  receivedAt: Date;
  latestActivityAt?: Date | null;
  lifecycle: BusinessContactLifecycle;
  thresholdDays?: number;
  now?: Date;
}): boolean {
  if (input.lifecycle === BusinessContactLifecycle.Anonymized) return false;
  const days = normalizeReviewThresholdDays(input.thresholdDays ?? CONTACT_REVIEW_DEFAULT_DAYS);
  const now = input.now ?? new Date();
  const latest = input.latestActivityAt && input.latestActivityAt > input.receivedAt ? input.latestActivityAt : input.receivedAt;
  return now.getTime() - latest.getTime() > days * 24 * 60 * 60 * 1000;
}

/** The cutoff instant for a review threshold — anything with latest activity strictly before this qualifies. */
export function contactReviewCutoff(thresholdDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - normalizeReviewThresholdDays(thresholdDays) * 24 * 60 * 60 * 1000);
}

// ---- Anonymization field policy (the single source of truth for WHAT is cleared) --------------------------
/**
 * Direct personal fields cleared to NULL by anonymization. Named explicitly so the policy is reviewable in one
 * place rather than scattered through an update statement.
 */
export const CONTACT_ANONYMIZED_FIELDS = [
  "fullName", "email", "phone", "company", "messageSummary",
  "consentReference", "consentVersion", "assignedUserId",
  // A pseudonymous provider identifier that would let anyone holding the lead id re-link the tombstone to the
  // person's provider record. NOT needed for replay protection — `dedupeKey` carries that.
  "externalLeadId",
] as const;

/**
 * Fields RETAINED on the tombstone, with the reason each is kept. Retained values are operational metadata
 * about the advertisement or the delivery, not about the person.
 */
export const CONTACT_TOMBSTONE_RETAINED = {
  dedupeKey: "required for replay/idempotency — dropping it would let a provider replay re-create the contact",
  sourcePlatform: "operational category, used for aggregate counts and the safe audit `source` label",
  provider: "operational category",
  connectionId: "operational link to the connection, not to the person",
  campaignId: "advertiser-authored campaign metadata, not lead-entered",
  formId: "advertiser-authored form metadata, not lead-entered",
  adId: "advertiser-authored ad metadata, not lead-entered",
  receivedAt: "non-identifying timestamp needed for retention arithmetic and audit ordering",
  consentValue: "a lone boolean; non-identifying once the subject is unidentifiable",
} as const;

/** The generic marker stored in place of a redacted note body. Never localized — the UI renders its own label. */
export const REDACTED_NOTE_MARKER = null;

/** The single export row emitted for an anonymized contact when explicitly filtered. No personal or provider value. */
export function contactTombstoneExportRow(receivedAt: Date, latestActivityAt: Date): string[] {
  return [
    "", "", "", "",                                   // full_name, email, phone, company
    "",                                                // source — withheld: narrows re-identification
    "", "",                                            // campaign_name, form_name
    receivedAt.toISOString(),
    BusinessContactLifecycle.Anonymized,               // status column carries the tombstone marker
    "",                                                // assigned_to
    latestActivityAt.toISOString(),
  ];
}
