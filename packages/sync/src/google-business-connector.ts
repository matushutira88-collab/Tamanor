/**
 * V1.36 Google Business Profile connector — READ-ONLY REVIEW MONITORING.
 *
 * Tamanor reads and analyzes Google reviews for VERIFIED locations the user is
 * authorized to manage. There are NO write actions: no reply, no delete, no
 * report, no review manipulation — ever. Everything is fail-closed:
 *   - config missing            → google_business_not_configured
 *   - GOOGLE_BUSINESS_API_ENABLED=false → google_business_api_disabled
 *   - no real executor / access → google_business_access_not_approved
 *   - unverified location        → google_business_location_not_verified
 *
 * ── Official Google Business Profile API notes (verify against current docs):
 *   • API access is NOT automatic — it requires a Google Cloud project + an
 *     approved Business Profile API access request + the APIs enabled.
 *   • All requests use OAuth 2.0; the ONLY scope requested is business.manage.
 *   • Review list operations are valid only for VERIFIED locations.
 *   • Reviews expose reviewer displayName (often no stable public reviewer id),
 *     a star rating enum (ONE..FIVE), optional comment, create/update times, and
 *     an optional owner reply (read-only metadata).
 *   • Tamanor never bypasses Google authorization — each user connects their own
 *     Google account and only their authorized locations are accessed.
 */
import { actorIdentityKey, type PlatformKey } from "@guardora/core";
import { getGoogleBusinessConfig, GOOGLE_BUSINESS_SCOPE } from "@guardora/config";
import { sentimentBucket, type SentimentBucket } from "@guardora/ai";
import type { FetchedContent } from "@guardora/connectors";

export { GOOGLE_BUSINESS_SCOPE };
export const GOOGLE_BUSINESS_PLATFORM: PlatformKey = "google_business";

/** Audit event names for the connector (no tokens/secrets ever in metadata). */
export const GOOGLE_BUSINESS_AUDIT = {
  connected: "google_business.connected",
  reconnected: "google_business.reconnected",
  disconnected: "google_business.disconnected",
  accountSelected: "google_business.account_selected",
  locationsSelected: "google_business.locations_selected",
  syncStarted: "google_business.sync_started",
  syncCompleted: "google_business.sync_completed",
  syncFailed: "google_business.sync_failed",
} as const;

// ---------------------------------------------------------------------------
// Normalized result reasons — product-level, never raw Google payloads.
// ---------------------------------------------------------------------------
export type GoogleBusinessReason =
  | "google_business_not_configured"
  | "google_business_api_disabled"
  | "google_business_access_not_approved"
  | "google_business_permission_missing"
  | "google_business_account_not_found"
  | "google_business_location_not_found"
  | "google_business_location_not_verified"
  | "google_business_token_expired"
  | "google_business_refresh_failed"
  | "google_business_quota_exceeded"
  | "google_business_access_denied"
  | "google_business_review_sync_failed"
  | "google_business_sync_succeeded"
  | "google_business_no_reviews"
  | "google_business_review_unavailable";

// ---------------------------------------------------------------------------
// Account + location discovery types.
// ---------------------------------------------------------------------------
export interface GoogleBusinessAccount {
  providerAccountName: string; // raw resource name — internal only
  providerAccountId: string;
  accountName: string | null;
  accountType: string | null;
  role: string | null;
  verificationState?: string | null;
}

export type LocationVerification = "verified" | "unverified" | "unknown";

export interface GoogleBusinessLocation {
  providerLocationName: string; // raw resource name — internal only
  providerLocationId: string;
  displayName: string;
  storeCode?: string | null;
  addressSummary?: string | null;
  verificationState: LocationVerification;
  selected: boolean;
  lastSyncedAt?: Date | null;
}

/** Normalize a raw Google account node. Never fabricates fields. */
export function normalizeGoogleAccount(raw: { name?: string; accountName?: string; type?: string; role?: string; verificationState?: string }): GoogleBusinessAccount {
  const providerAccountName = raw.name ?? "";
  return {
    providerAccountName,
    providerAccountId: providerAccountName.split("/").pop() ?? providerAccountName,
    accountName: raw.accountName ?? null,
    accountType: raw.type ?? null,
    role: raw.role ?? null,
    verificationState: raw.verificationState ?? null,
  };
}

/**
 * Normalize a raw Google location node. Verification is derived ONLY from a safe
 * signal; when Google does not expose it, we mark "unknown" honestly (never
 * invent "verified").
 */
export function normalizeGoogleLocation(raw: { name?: string; title?: string; storeCode?: string; storefrontAddress?: { addressLines?: string[]; locality?: string }; metadata?: { hasVoiceOfMerchant?: boolean }; verificationState?: string }): GoogleBusinessLocation {
  const providerLocationName = raw.name ?? "";
  const addr = raw.storefrontAddress;
  const addressSummary = addr ? [addr.addressLines?.join(" "), addr.locality].filter(Boolean).join(", ") || null : null;
  let verificationState: LocationVerification = "unknown";
  if (raw.verificationState === "VERIFIED" || raw.metadata?.hasVoiceOfMerchant === true) verificationState = "verified";
  else if (raw.verificationState === "UNVERIFIED" || raw.metadata?.hasVoiceOfMerchant === false) verificationState = "unverified";
  return {
    providerLocationName,
    providerLocationId: providerLocationName.split("/").pop() ?? providerLocationName,
    displayName: raw.title ?? "",
    storeCode: raw.storeCode ?? null,
    addressSummary,
    verificationState,
    selected: false,
  };
}

/**
 * Account selection is NEVER silent. Returns the single account only when there
 * is exactly one; otherwise the caller must present a selection step.
 */
export function requiresAccountSelection(accounts: GoogleBusinessAccount[]): boolean {
  return accounts.length !== 1;
}

/** Only VERIFIED locations may be enabled for review sync. */
export function isLocationSyncEligible(location: GoogleBusinessLocation): boolean {
  return location.verificationState === "verified";
}

// ---------------------------------------------------------------------------
// Review normalization.
// ---------------------------------------------------------------------------
const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export function starRatingToNumber(star: string | number | undefined): number {
  if (typeof star === "number") return Math.max(1, Math.min(5, Math.round(star)));
  return STAR_MAP[String(star ?? "").toUpperCase()] ?? 0;
}

/** Deterministic, non-crypto hash (no Date.now/Math.random — resume-safe). */
function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface RawGoogleReview {
  reviewId?: string;
  name?: string; // resource name (fallback id)
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string | number;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string } | null;
}

export interface NormalizedReview {
  platform: PlatformKey;
  accountId: string;
  locationId: string;
  externalReviewId: string;
  reviewerDisplayName: string | null;
  reviewerAnonymous: boolean;
  /** Privacy-safe, platform + LOCATION-scoped synthetic identity (never global). */
  authorExternalId: string;
  actorKey: string | null;
  rating: number;
  text: string;
  createTime: Date;
  updateTime: Date | null;
  ownerReply: string | null;
}

/**
 * Normalize a Google review. Reviewer identity is a privacy-safe, platform +
 * location-scoped synthetic id — display name alone is NEVER treated as globally
 * unique, and no cross-review identity certainty is claimed. Rating-only reviews
 * (empty comment) are preserved with their real (empty) text.
 */
export function normalizeGoogleReview(raw: RawGoogleReview, ctx: { accountId: string; locationId: string }): NormalizedReview {
  const externalReviewId = raw.reviewId ?? raw.name ?? "";
  const displayName = raw.reviewer?.displayName?.trim() || null;
  const anonymous = raw.reviewer?.isAnonymous === true || !displayName;
  // Location-scoped synthetic identity: anonymous → per-review (no cross-review link);
  // named → per-location hash of the name (not a global id, not the raw name).
  const authorExternalId = anonymous
    ? `loc:${ctx.locationId}:anon:${externalReviewId}`
    : `loc:${ctx.locationId}:r:${stableHash(displayName!)}`;
  return {
    platform: "google_business",
    accountId: ctx.accountId,
    locationId: ctx.locationId,
    externalReviewId,
    reviewerDisplayName: displayName,
    reviewerAnonymous: anonymous,
    authorExternalId,
    actorKey: actorIdentityKey("google_business", authorExternalId, displayName),
    rating: starRatingToNumber(raw.starRating),
    text: raw.comment ?? "",
    createTime: raw.createTime ? new Date(raw.createTime) : new Date(0),
    updateTime: raw.updateTime ? new Date(raw.updateTime) : null,
    ownerReply: raw.reviewReply?.comment ?? null,
  };
}

/** Dedupe reviews by stable review id (idempotent sync). Order-preserving. */
export function dedupeReviews(reviews: NormalizedReview[]): NormalizedReview[] {
  const seen = new Set<string>();
  const out: NormalizedReview[] = [];
  for (const r of reviews) {
    if (r.externalReviewId && seen.has(r.externalReviewId)) continue;
    if (r.externalReviewId) seen.add(r.externalReviewId);
    out.push(r);
  }
  return out;
}

/**
 * Deterministic review sentiment baseline (I). Risky ALWAYS wins via the shared
 * classifier (scam/threat/phishing/hate/etc.); otherwise stars drive it:
 * 4–5★ positive, 3★ neutral, 1–2★ negative. A low rating is NEVER automatically
 * risky, and normal criticism stays negative/neutral.
 */
export function reviewSentiment(rating: number, categories: string[] = [], storedSentiment?: string): SentimentBucket {
  const ratingSentiment = rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";
  const bucket = sentimentBucket({ categories, sentiment: storedSentiment ?? ratingSentiment, riskLevel: "none" });
  if (bucket === "risky") return "risky";
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  if (rating >= 1) return "negative";
  return bucket; // rating unknown → fall back to classifier
}

// ---------------------------------------------------------------------------
// OAuth helpers (server-side; scope is business.manage ONLY).
// ---------------------------------------------------------------------------
export function buildGoogleAuthUrl(input: { clientId: string; redirectUri: string; state: string; codeChallenge?: string }): string {
  const p = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_BUSINESS_SCOPE,
    access_type: "offline", // refresh token for background review sync
    prompt: "consent",
    state: input.state,
  });
  if (input.codeChallenge) { p.set("code_challenge", input.codeChallenge); p.set("code_challenge_method", "S256"); }
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/**
 * SLICE 1 — server-side authorization-code exchange.
 *
 * The browser never sees the client secret and never performs this call. The response body is parsed
 * ONLY for the fields below; nothing derived from it (token, raw body, provider error text) is ever
 * returned to a caller, logged, audited or placed in a URL. Failures collapse into the existing
 * bounded {@link GoogleBusinessReason} vocabulary.
 *
 * `refresh_token` is REQUIRED: without it there is no unattended review sync, so a grant that omits it
 * (a re-consent where Google withholds it) is treated as a failure rather than a half-connected state.
 * `buildGoogleAuthUrl` already sends access_type=offline + prompt=consent to force its issuance.
 */
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleTokenExchangeResult {
  ok: boolean;
  reason: GoogleBusinessReason | "google_business_exchange_ok";
  /** Present ONLY on success. Callers must hand these straight to the vault. */
  credentials?: {
    refreshToken: string;
    accessToken: string;
    /** Absolute expiry derived from expires_in at exchange time. */
    accessTokenExpiresAt: Date;
    tokenType: string;
    /** Scopes Google actually granted (may be a subset of what was requested). */
    scopes: string[];
  };
}

export type GoogleTokenFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export async function exchangeGoogleAuthCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: GoogleTokenFetch;
  now?: () => number;
  timeoutMs?: number;
}): Promise<GoogleTokenExchangeResult> {
  if (!input.code) return { ok: false, reason: "google_business_access_denied" };
  const fetchImpl = (input.fetchImpl ?? (globalThis.fetch as unknown as GoogleTokenFetch));
  const now = input.now ?? (() => Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      signal: controller.signal,
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      // A revoked/expired/replayed code is `invalid_grant`; anything else is a generic refusal.
      const err = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
      return { ok: false, reason: err === "invalid_grant" ? "google_business_token_expired" : "google_business_refresh_failed" };
    }
    const t = (body ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; token_type?: unknown; scope?: unknown };
    const accessToken = typeof t.access_token === "string" ? t.access_token : "";
    const refreshToken = typeof t.refresh_token === "string" ? t.refresh_token : "";
    if (!accessToken) return { ok: false, reason: "google_business_refresh_failed" };
    // No refresh token ⇒ no unattended sync ⇒ refuse rather than store a half-usable grant.
    if (!refreshToken) return { ok: false, reason: "google_business_permission_missing" };
    const expiresInSec = typeof t.expires_in === "number" && Number.isFinite(t.expires_in) ? t.expires_in : 3600;
    const granted = typeof t.scope === "string" && t.scope.trim() ? t.scope.trim().split(/\s+/) : [GOOGLE_BUSINESS_SCOPE];
    // The connector is useless without business.manage — a downgraded grant is refused.
    if (!granted.includes(GOOGLE_BUSINESS_SCOPE)) return { ok: false, reason: "google_business_permission_missing" };
    return {
      ok: true,
      reason: "google_business_exchange_ok",
      credentials: {
        refreshToken,
        accessToken,
        accessTokenExpiresAt: new Date(now() + expiresInSec * 1000),
        tokenType: typeof t.token_type === "string" ? t.token_type : "Bearer",
        scopes: granted,
      },
    };
  } catch {
    // Abort/network — indistinguishable by design; never surfaces a provider message.
    return { ok: false, reason: "google_business_refresh_failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Constant-time-ish state comparison for the OAuth CSRF check. */
export function validateOAuthState(received: string | null | undefined, expected: string | null | undefined): boolean {
  return !!received && !!expected && received === expected;
}

/**
 * SLICE 3A — REFRESH an expired / near-expiry Google access token.
 *
 * Same shape and the same discipline as {@link exchangeGoogleAuthCode}: server-side only, the response
 * body is read for exactly the fields below, and nothing derived from it — token, raw body, provider
 * error text — is returned, logged, audited or placed in a URL. Failures collapse into a bounded,
 * ACTIONABLE classification, because the caller must treat "reconnect the user" very differently from
 * "retry in a minute".
 *
 * REFRESH-TOKEN ROTATION. Google usually omits `refresh_token` on a refresh, meaning "keep the one you
 * have". It occasionally returns a NEW one, which then replaces the old. Both cases are represented
 * explicitly (`rotatedRefreshToken` is null vs a string) so the vault write is never a guess: a missing
 * field must never be mistaken for "the refresh token was revoked".
 */
export const GOOGLE_REFRESH_MAX_SKEW_MS = 5 * 60_000;

/**
 * How a refresh failed, in terms of what the CALLER should do about it. This is deliberately not the
 * same vocabulary as {@link GoogleBusinessReason}: that one describes review-sync outcomes, this one
 * describes credential health.
 */
export type GoogleRefreshFailure =
  /** The grant is permanently dead (invalid_grant: user revoked, or the refresh token was rotated away). */
  | "reconnect_required"
  /** Our client id/secret are wrong or the client was deleted — a DEPLOYMENT fault, not the user's. */
  | "configuration_invalid"
  /** Google is rate limiting us. Retry later. */
  | "rate_limited"
  /** 5xx / transport / timeout. Retry later. */
  | "transient_failure"
  /** 2xx whose body we could not use (no access_token, unparseable). Not retried blindly. */
  | "malformed_response";

/** True for failures where trying again later is reasonable; false for terminal ones. */
export function isRetryableRefreshFailure(f: GoogleRefreshFailure): boolean {
  return f === "rate_limited" || f === "transient_failure";
}

export type GoogleRefreshResult =
  | {
    ok: true;
    accessToken: string;
    accessTokenExpiresAt: Date;
    tokenType: string;
    scopes: string[];
    /** Non-null ONLY when Google issued a replacement. Null means "keep the existing refresh token". */
    rotatedRefreshToken: string | null;
  }
  | { ok: false; failure: GoogleRefreshFailure };

export async function refreshGoogleAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: GoogleTokenFetch;
  now?: () => number;
  timeoutMs?: number;
}): Promise<GoogleRefreshResult> {
  if (!input.refreshToken) return { ok: false, failure: "reconnect_required" };
  if (!input.clientId || !input.clientSecret) return { ok: false, failure: "configuration_invalid" };
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as GoogleTokenFetch);
  const now = input.now ?? (() => Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        refresh_token: input.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: controller.signal,
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }

    if (!res.ok) {
      const err = body && typeof body === "object" ? String((body as { error?: unknown }).error ?? "") : "";
      // invalid_grant is the ONLY terminal, user-actionable case: the grant no longer exists.
      if (err === "invalid_grant") return { ok: false, failure: "reconnect_required" };
      // Our credentials are wrong. Reconnecting the user would not help and must not be suggested.
      if (err === "invalid_client" || err === "unauthorized_client" || res.status === 401) return { ok: false, failure: "configuration_invalid" };
      if (res.status === 429) return { ok: false, failure: "rate_limited" };
      if (res.status >= 500) return { ok: false, failure: "transient_failure" };
      return { ok: false, failure: "malformed_response" };
    }

    const t = (body ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; token_type?: unknown; scope?: unknown };
    const accessToken = typeof t.access_token === "string" ? t.access_token : "";
    if (!accessToken) return { ok: false, failure: "malformed_response" };
    const expiresInSec = typeof t.expires_in === "number" && Number.isFinite(t.expires_in) && t.expires_in > 0 ? t.expires_in : 3600;
    const granted = typeof t.scope === "string" && t.scope.trim() ? t.scope.trim().split(/\s+/) : [GOOGLE_BUSINESS_SCOPE];
    // A refresh that came back WITHOUT business.manage cannot drive review sync; treat it as a dead grant
    // rather than storing a token that will fail every subsequent call.
    if (!granted.includes(GOOGLE_BUSINESS_SCOPE)) return { ok: false, failure: "reconnect_required" };
    return {
      ok: true,
      accessToken,
      accessTokenExpiresAt: new Date(now() + expiresInSec * 1000),
      tokenType: typeof t.token_type === "string" ? t.token_type : "Bearer",
      scopes: granted,
      // ABSENT means "keep the existing refresh token" — never "it was revoked".
      rotatedRefreshToken: typeof t.refresh_token === "string" && t.refresh_token ? t.refresh_token : null,
    };
  } catch {
    // Abort/network/DNS — retryable, and the underlying message never escapes.
    return { ok: false, failure: "transient_failure" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Should we refresh before using this access token? True when it is already expired OR falls inside the
 * safety window, so a token that would die mid-sync is replaced up front rather than causing a 401.
 * A NULL expiry is treated as unknown-and-therefore-stale (fail-closed).
 */
export function googleAccessTokenNeedsRefresh(expiresAt: Date | null | undefined, nowMs: number, skewMs = GOOGLE_REFRESH_MAX_SKEW_MS): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - nowMs <= skewMs;
}

/**
 * SLICE 1/2 — live discovery of what the grant authorises, FULLY PAGINATED.
 *
 * Reuses the EXISTING client (`listAccounts` / `listLocations`) and the EXISTING normalizers, so
 * verification and sync-eligibility semantics are unchanged. Slice 2 made this exhaustive: a customer
 * choosing which location to connect must see ALL of them, so both listings follow `nextPageToken`
 * until the provider stops — never a silent first page.
 *
 * PAGINATION SAFETY (all fail-closed, all deterministic):
 *   · a hard page cap per listing ({@link GOOGLE_DISCOVERY_MAX_PAGES}) bounds a runaway cursor;
 *   · a REPEATED page token — the classic provider bug that loops forever — stops the listing;
 *   · a non-string/empty token is treated as "no more pages" rather than being sent back;
 *   · a hard item cap per listing bounds memory even if every page is honoured;
 *   · locations are deduped by providerLocationId, keeping FIRST occurrence, so an overlapping page
 *     boundary can never produce two selectable rows for one real location.
 * When a bound or a loop is hit the result reports `truncated: true` so the caller can say so out loud
 * instead of quietly presenting a partial list as complete.
 *
 * Returns only normalized, non-secret business metadata. Any provider failure collapses into the
 * bounded reason vocabulary — the raw error never escapes.
 */
/** Hard ceiling on pages followed per listing. 20 × pageSize 100 = 2000 locations per account. */
export const GOOGLE_DISCOVERY_MAX_PAGES = 20;
/** Hard ceiling on items collected per listing, independent of page count. */
export const GOOGLE_DISCOVERY_MAX_ITEMS = 2_000;
export interface GoogleDiscoveryResult {
  ok: boolean;
  reason: GoogleBusinessReason | "google_business_discovery_ok";
  accounts: GoogleBusinessAccount[];
  locationsByAccount: Record<string, GoogleBusinessLocation[]>;
  /** Convenience for Slice 2: locations that are actually eligible to sync. */
  eligibleLocationCount: number;
  /** True when a page cap, item cap or repeated-token loop stopped a listing early. */
  truncated: boolean;
}

export interface GoogleDiscoveryClient {
  listAccounts(pageToken?: string): Promise<{ accounts: unknown[]; nextPageToken?: string }>;
  listLocations(accountResourceName: string, pageToken?: string): Promise<{ locations: unknown[]; nextPageToken?: string }>;
}

/**
 * Follow `nextPageToken` for one listing, with every safety bound applied. `fetchPage` is the only
 * provider-touching part; everything else is pure and deterministic.
 */
async function collectPages<T>(
  fetchPage: (pageToken?: string) => Promise<{ items: unknown[]; nextPageToken?: string }>,
  normalize: (raw: unknown) => T,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  const seenTokens = new Set<string>();
  let token: string | undefined;
  let truncated = false;

  for (let page = 0; page < GOOGLE_DISCOVERY_MAX_PAGES; page++) {
    const res = await fetchPage(token);
    for (const raw of res.items ?? []) {
      if (items.length >= GOOGLE_DISCOVERY_MAX_ITEMS) { truncated = true; break; }
      items.push(normalize(raw ?? {}));
    }
    if (truncated) break;

    const next = res.nextPageToken;
    // A missing, non-string or empty token means the listing is complete. Never echo such a value back.
    if (typeof next !== "string" || next.trim() === "") return { items, truncated };
    // A token we have already sent means the provider is looping. Stop rather than paginate forever.
    if (seenTokens.has(next)) return { items, truncated: true };
    seenTokens.add(next);
    token = next;
    // The loop condition itself enforces the page cap; reaching it without returning is a truncation.
    if (page === GOOGLE_DISCOVERY_MAX_PAGES - 1) truncated = true;
  }
  return { items, truncated };
}

/** Dedupe locations by providerLocationId, keeping the FIRST occurrence (deterministic across pages). */
function dedupeLocations(locations: GoogleBusinessLocation[]): GoogleBusinessLocation[] {
  const seen = new Set<string>();
  const out: GoogleBusinessLocation[] = [];
  for (const l of locations) {
    const key = l.providerLocationId || l.providerLocationName;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

export async function discoverGoogleBusinessScope(client: GoogleDiscoveryClient, opts: { maxAccounts?: number } = {}): Promise<GoogleDiscoveryResult> {
  const empty = { accounts: [] as GoogleBusinessAccount[], locationsByAccount: {} as Record<string, GoogleBusinessLocation[]>, eligibleLocationCount: 0, truncated: false };
  let accountPages: { items: GoogleBusinessAccount[]; truncated: boolean };
  try {
    accountPages = await collectPages(
      async (t) => { const r = await client.listAccounts(t); return { items: r.accounts ?? [], nextPageToken: r.nextPageToken }; },
      (raw) => normalizeGoogleAccount(raw as Parameters<typeof normalizeGoogleAccount>[0]),
    );
  } catch {
    return { ok: false, reason: "google_business_access_denied", ...empty };
  }
  const accounts = accountPages.items;
  // A grant that sees zero accounts cannot be presented as a working connection.
  if (accounts.length === 0) return { ok: false, reason: "google_business_account_not_found", ...empty };
  let truncated = accountPages.truncated;

  // Keyed by providerAccountId (the trailing segment), NOT the raw resource name — the map is handed
  // to the caller, and the raw name stays internal per this file's existing convention.
  const locationsByAccount: Record<string, GoogleBusinessLocation[]> = {};
  let eligible = 0;
  for (const acct of accounts.slice(0, Math.max(1, opts.maxAccounts ?? 10))) {
    try {
      // listLocations expects the RAW resource name ("accounts/123"), which is what the client sends on.
      const page = await collectPages(
        async (t) => { const r = await client.listLocations(acct.providerAccountName, t); return { items: r.locations ?? [], nextPageToken: r.nextPageToken }; },
        (raw) => normalizeGoogleLocation(raw as Parameters<typeof normalizeGoogleLocation>[0]),
      );
      const locs = dedupeLocations(page.items);
      locationsByAccount[acct.providerAccountId] = locs;
      eligible += locs.filter(isLocationSyncEligible).length;
      if (page.truncated) truncated = true;
    } catch {
      // One account failing must not discard the accounts already discovered — but the list this
      // customer is shown IS then incomplete, and must say so.
      locationsByAccount[acct.providerAccountId] = [];
      truncated = true;
    }
  }
  if (accounts.length > Math.max(1, opts.maxAccounts ?? 10)) truncated = true;
  return { ok: true, reason: "google_business_discovery_ok", accounts, locationsByAccount, eligibleLocationCount: eligible, truncated };
}

// ---------------------------------------------------------------------------
// Review list adapter — fail-closed; real Graph call is injected (never here).
// ---------------------------------------------------------------------------
export interface ListReviewsInput { accountId: string; location: GoogleBusinessLocation; pageSize?: number; pageToken?: string; orderBy?: string }
export interface RawReviewPage { reviews?: RawGoogleReview[]; nextPageToken?: string; error?: { code?: string | number | null; status?: string | null; message?: string | null } }
export type GoogleReviewExecutor = (input: ListReviewsInput) => Promise<RawReviewPage>;

export interface ListReviewsResult {
  reason: GoogleBusinessReason;
  reviews: NormalizedReview[];
  nextPageToken?: string;
  ok: boolean;
}

/** Map a raw Google/API error onto a normalized reason. No raw payload leaks. */
export function mapGoogleBusinessError(err: { code?: string | number | null; status?: string | null; message?: string | null }): GoogleBusinessReason {
  const hay = `${err.code ?? ""} ${err.status ?? ""} ${(err.message ?? "").toLowerCase()}`;
  if (/401|unauthenticated|token|expired/i.test(hay)) return "google_business_token_expired";
  if (/refresh/i.test(hay)) return "google_business_refresh_failed";
  if (/permission|scope|forbidden|not authorized/i.test(hay)) return "google_business_permission_missing";
  if (/quota|rate|resource_exhausted/i.test(hay)) return "google_business_quota_exceeded";
  if (/not.?approved|access.?not|accessNotConfigured|api not enabled/i.test(hay)) return "google_business_access_not_approved";
  if (/403|access.?denied|permission_denied/i.test(hay)) return "google_business_access_denied";
  if (/location.*not.*verif|not.?verified/i.test(hay)) return "google_business_location_not_verified";
  if (/location.*not.*found/i.test(hay)) return "google_business_location_not_found";
  if (/account.*not.*found/i.test(hay)) return "google_business_account_not_found";
  if (/review.*not.*found|review.*unavailable|deleted/i.test(hay)) return "google_business_review_unavailable";
  return "google_business_review_sync_failed";
}

/**
 * List reviews for one location. Fail-closed at every gate; a live call only
 * happens when config is present, the API flag is on, the location is VERIFIED
 * and a real executor is injected.
 */
export async function listGoogleBusinessReviews(input: ListReviewsInput, opts: { source?: NodeJS.ProcessEnv; executor?: GoogleReviewExecutor } = {}): Promise<ListReviewsResult> {
  const cfg = getGoogleBusinessConfig(opts.source);
  if (!cfg.configured) return { reason: "google_business_not_configured", reviews: [], ok: false };
  if (!cfg.apiEnabled) return { reason: "google_business_api_disabled", reviews: [], ok: false };
  if (!isLocationSyncEligible(input.location)) return { reason: "google_business_location_not_verified", reviews: [], ok: false };
  if (!opts.executor) return { reason: "google_business_access_not_approved", reviews: [], ok: false };
  try {
    const page = await opts.executor(input);
    if (page.error) return { reason: mapGoogleBusinessError(page.error), reviews: [], ok: false };
    const reviews = dedupeReviews((page.reviews ?? []).map((r) => normalizeGoogleReview(r, { accountId: input.accountId, locationId: input.location.providerLocationId })));
    if (reviews.length === 0 && !page.nextPageToken) return { reason: "google_business_no_reviews", reviews: [], ok: true };
    return { reason: "google_business_sync_succeeded", reviews, nextPageToken: page.nextPageToken, ok: true };
  } catch (e) {
    return { reason: mapGoogleBusinessError({ message: e instanceof Error ? e.message : String(e) }), reviews: [], ok: false };
  }
}

// ---------------------------------------------------------------------------
// SLICE 3A — exhaustive review fetch + canonical content mapping.
// ---------------------------------------------------------------------------

/** Hard ceiling on review pages followed per location. 20 x pageSize 50 = 1000 reviews per sync. */
export const GOOGLE_REVIEW_MAX_PAGES = 20;
/** Hard ceiling on reviews collected per location, independent of page count. */
export const GOOGLE_REVIEW_MAX_ITEMS = 1_000;

export interface FetchAllReviewsResult {
  ok: boolean;
  reason: GoogleBusinessReason;
  reviews: NormalizedReview[];
  /**
   * True when a page cap, item cap or a repeated page token stopped the walk. A truncated fetch is NOT
   * a complete sync and the caller must not record it as one.
   */
  truncated: boolean;
  pages: number;
}

/**
 * Walk EVERY page of reviews for one location, reusing the existing per-page
 * {@link listGoogleBusinessReviews} (which keeps all of its fail-closed gates: config, API flag,
 * location verification, and the requirement that a real executor was injected).
 *
 * Safety bounds mirror discovery, and for the same reasons:
 *   · a hard page cap and a hard item cap bound a runaway cursor;
 *   · a REPEATED page token — the provider bug that loops forever — stops the walk;
 *   · a non-string/blank token means "no more pages" and is never echoed back;
 *   · reviews are deduped by provider review id across pages, so an overlapping page boundary cannot
 *     produce two records for one real review.
 *
 * A failure on page 1 fails the whole fetch. A failure on a LATER page keeps what was already read and
 * reports `truncated` — losing 400 already-fetched reviews because page 9 timed out would be worse, but
 * calling that a complete sync would be a lie.
 */
export async function fetchAllGoogleReviews(
  input: Omit<ListReviewsInput, "pageToken">,
  opts: { source?: NodeJS.ProcessEnv; executor?: GoogleReviewExecutor; maxPages?: number; maxItems?: number } = {},
): Promise<FetchAllReviewsResult> {
  const maxPages = Math.max(1, opts.maxPages ?? GOOGLE_REVIEW_MAX_PAGES);
  const maxItems = Math.max(1, opts.maxItems ?? GOOGLE_REVIEW_MAX_ITEMS);
  const collected: NormalizedReview[] = [];
  const seenReviewIds = new Set<string>();
  const seenTokens = new Set<string>();
  let token: string | undefined;
  let truncated = false;
  let pages = 0;
  let lastReason: GoogleBusinessReason = "google_business_no_reviews";

  for (; pages < maxPages; pages++) {
    const page = await listGoogleBusinessReviews({ ...input, pageToken: token }, opts);
    if (!page.ok) {
      // Page 1 failing means we have nothing and no basis to claim success.
      if (pages === 0) return { ok: false, reason: page.reason, reviews: [], truncated: false, pages: 0 };
      // A later page failing keeps what we have, but the fetch is incomplete.
      return { ok: true, reason: lastReason, reviews: collected, truncated: true, pages };
    }
    lastReason = page.reason;
    for (const r of page.reviews) {
      // Never invent an id, and never let one provider review occupy two slots.
      if (!r.externalReviewId || seenReviewIds.has(r.externalReviewId)) continue;
      if (collected.length >= maxItems) { truncated = true; break; }
      seenReviewIds.add(r.externalReviewId);
      collected.push(r);
    }
    if (truncated) { pages++; break; }

    const next = page.nextPageToken;
    if (typeof next !== "string" || next.trim() === "") { pages++; break; }
    if (seenTokens.has(next)) { truncated = true; pages++; break; }
    seenTokens.add(next);
    token = next;
    if (pages === maxPages - 1) truncated = true;
  }

  return {
    ok: true,
    reason: collected.length === 0 ? "google_business_no_reviews" : "google_business_sync_succeeded",
    reviews: collected,
    truncated,
    pages,
  };
}

/**
 * Map ONE normalized Google review onto the canonical {@link FetchedContent} the existing ingest path
 * already understands. No Google-specific persistence exists: a review becomes an ordinary ContentItem
 * of kind `review`, which the shared pipeline then classifies and projects into a ReputationItem
 * exactly as a Facebook comment does.
 *
 * Only fields the canonical model already has are carried. The raw Google payload, the owner reply, the
 * location resource name and every other provider detail are deliberately dropped — Slice 3A persists
 * nothing it does not need, and replies are a later slice.
 */
export function googleReviewToFetchedContent(review: NormalizedReview): FetchedContent {
  return {
    platform: "google_business" as FetchedContent["platform"],
    kind: "review" as FetchedContent["kind"],
    externalId: review.externalReviewId,
    // The location this review belongs to — the canonical "parent object" for a review.
    externalParentId: review.locationId,
    // Rating-only reviews are legitimate and keep an empty body rather than an invented one.
    text: review.text,
    author: {
      // Privacy-safe, location-scoped synthetic identity from the EXISTING normalizer — never a raw
      // Google account id, and never a globally linkable one.
      externalId: review.authorExternalId,
      // Anonymous reviewers contribute no display name at all.
      displayName: review.reviewerAnonymous ? undefined : (review.reviewerDisplayName ?? undefined),
    },
    rating: review.rating > 0 ? review.rating : undefined,
    publishedAt: review.createTime.toISOString() as FetchedContent["publishedAt"],
    // Google's review API returns no stable public permalink for a review, so none is invented.
    permalink: undefined,
  };
}

// ---------------------------------------------------------------------------
// Structured diagnostics (N).
// ---------------------------------------------------------------------------
export interface GoogleBusinessDiagnostic {
  configured: boolean;
  apiEnabled: boolean;
  oauthReady: boolean;
  connected: boolean;
  tokenValid: boolean;
  refreshAvailable: boolean;
  accountCount: number;
  selectedAccount: boolean;
  locationCount: number;
  verifiedLocationCount: number;
  selectedLocationCount: number;
  reviewReadCapability: boolean;
  lastSyncAt: Date | null;
  lastSyncSucceeded: boolean | null;
  reason: GoogleBusinessReason;
}

export function googleBusinessDiagnostic(input: {
  source?: NodeJS.ProcessEnv;
  connected?: boolean;
  tokenValid?: boolean;
  refreshAvailable?: boolean;
  accounts?: GoogleBusinessAccount[];
  selectedAccountId?: string | null;
  locations?: GoogleBusinessLocation[];
  lastSyncAt?: Date | null;
  lastSyncSucceeded?: boolean | null;
}): GoogleBusinessDiagnostic {
  const cfg = getGoogleBusinessConfig(input.source);
  const accounts = input.accounts ?? [];
  const locations = input.locations ?? [];
  const verified = locations.filter(isLocationSyncEligible);
  const selectedLocations = locations.filter((l) => l.selected);
  const connected = !!input.connected;
  let reason: GoogleBusinessReason = "google_business_sync_succeeded";
  if (!cfg.configured) reason = "google_business_not_configured";
  else if (!cfg.apiEnabled) reason = "google_business_api_disabled";
  else if (!connected) reason = "google_business_access_not_approved";
  else if (input.tokenValid === false) reason = "google_business_token_expired";
  else if (accounts.length === 0) reason = "google_business_account_not_found";
  else if (!input.selectedAccountId) reason = "google_business_account_not_found";
  else if (verified.length === 0) reason = "google_business_location_not_verified";
  else if (input.lastSyncSucceeded === false) reason = "google_business_review_sync_failed";
  return {
    configured: cfg.configured,
    apiEnabled: cfg.apiEnabled,
    oauthReady: cfg.status === "oauth_ready" || cfg.status === "awaiting_approval",
    connected,
    tokenValid: input.tokenValid !== false,
    refreshAvailable: !!input.refreshAvailable,
    accountCount: accounts.length,
    selectedAccount: !!input.selectedAccountId,
    locationCount: locations.length,
    verifiedLocationCount: verified.length,
    selectedLocationCount: selectedLocations.length,
    reviewReadCapability: true, // Google Business supports review READ only
    lastSyncAt: input.lastSyncAt ?? null,
    lastSyncSucceeded: input.lastSyncSucceeded ?? null,
    reason,
  };
}
