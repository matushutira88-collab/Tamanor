import "server-only";
import { getGoogleBusinessConfig } from "@guardora/config";
import {
  discoverGoogleBusinessScope, isLocationSyncEligible,
  GoogleBusinessApiClient, createGoogleFetchTransport,
  type GoogleBusinessAccount, type GoogleBusinessLocation,
} from "@guardora/sync";
import {
  withTenantDb, resolveProviderCredentialOutcome, VaultDecryptError,
  BusinessProvider, BusinessConnectionStatus, ProviderCredentialPurpose,
} from "@guardora/db";
import type { AppSession } from "./auth";

/**
 * GOOGLE BUSINESS SLICE 2 — the discovery handoff.
 *
 * WHY THERE IS NO HANDOFF TABLE. The obvious design is to persist Slice 1's discovery result and read it
 * back on the selection page, the way Meta uses `meta_onboarding_sessions`. That table exists because
 * Meta's flow carries per-Page ACCESS TOKENS that must survive to the confirm step. Google needs nothing
 * of the sort: Slice 1 already sealed the credential in the ProviderCredential vault, so the selection
 * page can simply re-run discovery server-side, live, whenever it is rendered.
 *
 * That is strictly safer than persisting the result, and it is why this slice needs no migration:
 *   · the data is always authoritative and current — never a stale snapshot of a location that has since
 *     been unverified, renamed or removed;
 *   · no Google provider payload is stored anywhere, so there is nothing to leak or to expire;
 *   · the import step re-resolves the SAME way, which turns "validate the selection" from a bookkeeping
 *     exercise into the real question: is this location still authorized right now?
 *
 * WHAT CROSSES THE BROWSER BOUNDARY. Out: display metadata only (names, address summary, verification,
 * eligibility). Never a token, never a raw provider response. In: stable provider identifiers only —
 * a location id the server then re-resolves against a fresh discovery. A forged or foreign id simply
 * matches nothing in the server's list and is dropped.
 *
 * TOKEN HANDLING. The access token is read from the vault on the server, used for the API call, and
 * never returned from this module. An EXPIRED access token fails closed with `reconnect_required`
 * rather than being silently refreshed — background/on-demand token refresh is Slice 3 scope.
 */

/** One selectable row, as shown in the UI. Contains no secret and no raw provider payload. */
export interface SelectableLocation {
  /** Stable provider identity — the only value the browser may submit back. */
  locationId: string;
  displayName: string;
  storeCode: string | null;
  addressSummary: string | null;
  verificationState: GoogleBusinessLocation["verificationState"];
  /** Only verified locations may be connected; the UI must not offer the others. */
  eligible: boolean;
  /** Already imported as a ConnectedAccount — shown as connected, re-importable as a reconnect. */
  alreadyConnected: boolean;
}

export interface SelectableAccount {
  accountId: string;
  accountName: string | null;
  accountType: string | null;
  verificationState: string | null;
  locations: SelectableLocation[];
}

/** Bounded, renderable reasons the selection/import cannot proceed. Never provider text. */
export type SelectionUnavailableReason =
  "not_connected" | "reconnect_required" | "api_disabled" | "api_access_unconfirmed" | "not_configured" | "discovery_failed";

export type SelectionView =
  | {
    state: "ready";
    connectionId: string;
    accounts: SelectableAccount[];
    eligibleCount: number;
    /** True when a pagination bound or a provider loop stopped the listing early. */
    truncated: boolean;
    brands: Array<{ id: string; name: string }>;
  }
  | { state: "unavailable"; reason: SelectionUnavailableReason };

/** Resolve the tenant's live Google access token from the vault. Server-only; never returned upward. */
async function resolveAccessToken(tenantId: string, connectionId: string): Promise<{ ok: true; token: string } | { ok: false; reason: "reconnect_required" }> {
  try {
    const outcome = await resolveProviderCredentialOutcome({
      tenantId,
      provider: BusinessProvider.google,
      purpose: ProviderCredentialPurpose.access_token,
      connection: { businessConnectionId: connectionId },
    });
    // `absent`, `revoked` and an EXPIRED access token all mean the same thing to Slice 2: we cannot talk
    // to Google right now and must not pretend otherwise. Refreshing is Slice 3.
    if (outcome.state !== "present" || outcome.expired) return { ok: false, reason: "reconnect_required" };
    return { ok: true, token: outcome.plaintext };
  } catch (e) {
    // A VaultDecryptError is a security failure, never a soft fallback.
    if (e instanceof VaultDecryptError) return { ok: false, reason: "reconnect_required" };
    return { ok: false, reason: "reconnect_required" };
  }
}

/**
 * The gates + local state every entry point needs, resolved once. Everything here is fail-closed and
 * runs BEFORE any network call, exactly as the OAuth callback does.
 */
async function preflight(session: AppSession): Promise<
  | { ok: true; connectionId: string; token: string; importedIds: Set<string>; brands: Array<{ id: string; name: string }> }
  | { ok: false; reason: SelectionUnavailableReason }
> {
  const cfg = getGoogleBusinessConfig();
  if (!cfg.configured) return { ok: false, reason: "not_configured" };
  if (!cfg.apiEnabled) return { ok: false, reason: "api_disabled" };
  if (!cfg.apiApproved) return { ok: false, reason: "api_access_unconfirmed" };

  const local = await withTenantDb(session.tenantId, async (db) => {
    const connection = await db.businessPlatformConnection.findFirst({
      where: { tenantId: session.tenantId, provider: BusinessProvider.google },
      select: { id: true, status: true },
    });
    const [accounts, brands] = await Promise.all([
      db.connectedAccount.findMany({
        where: { tenantId: session.tenantId, platform: "google_business" as never },
        select: { externalId: true },
      }),
      db.brand.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    ]);
    return { connection, importedIds: new Set(accounts.map((a) => a.externalId)), brands };
  });

  // Only a connection Slice 1 actually took all the way to `active` may drive a selection step.
  if (!local.connection || local.connection.status !== BusinessConnectionStatus.active) {
    return { ok: false, reason: "not_connected" };
  }

  const cred = await resolveAccessToken(session.tenantId, local.connection.id);
  if (!cred.ok) return { ok: false, reason: cred.reason };
  return { ok: true, connectionId: local.connection.id, token: cred.token, importedIds: local.importedIds, brands: local.brands };
}

/**
 * Build the authoritative selection view for this tenant: fresh, fully paginated discovery joined with
 * which locations are already imported.
 */
export async function loadGoogleBusinessSelection(session: AppSession): Promise<SelectionView> {
  const pre = await preflight(session);
  if (!pre.ok) return { state: "unavailable", reason: pre.reason };

  const discovery = await discoverGoogleBusinessScope(
    new GoogleBusinessApiClient({ transport: createGoogleFetchTransport(), accessToken: pre.token }),
  );
  if (!discovery.ok) return { state: "unavailable", reason: "discovery_failed" };

  return {
    state: "ready",
    connectionId: pre.connectionId,
    accounts: toSelectable(discovery.accounts, discovery.locationsByAccount, pre.importedIds),
    eligibleCount: discovery.eligibleLocationCount,
    truncated: discovery.truncated,
    brands: pre.brands,
  };
}

/** Project normalized discovery into the browser-safe shape. Pure — easy to assert on in tests. */
export function toSelectable(
  accounts: GoogleBusinessAccount[],
  locationsByAccount: Record<string, GoogleBusinessLocation[]>,
  importedIds: Set<string>,
): SelectableAccount[] {
  return accounts.map((a) => ({
    accountId: a.providerAccountId,
    accountName: a.accountName,
    accountType: a.accountType,
    verificationState: a.verificationState ?? null,
    locations: (locationsByAccount[a.providerAccountId] ?? []).map((l) => ({
      locationId: l.providerLocationId,
      displayName: l.displayName,
      storeCode: l.storeCode ?? null,
      addressSummary: l.addressSummary ?? null,
      verificationState: l.verificationState,
      // Truthful and unchanged from Slice 1: ONLY verified locations may sync.
      eligible: isLocationSyncEligible(l),
      alreadyConnected: importedIds.has(l.providerLocationId),
    })),
  }));
}

/** One resolved, server-derived location, ready to import. */
export type ResolvedLocation = GoogleBusinessLocation & { providerAccountId: string };

export type ResolveSelectionResult =
  | { ok: true; connectionId: string; locations: ResolvedLocation[]; rejectedUnknown: number; rejectedIneligible: number }
  | { ok: false; reason: SelectionUnavailableReason };

/**
 * Re-resolve a browser-submitted set of location ids against a FRESH server-side discovery, and return
 * only those that are genuinely authorized AND eligible. This is the security boundary of the import:
 * the browser can only ever narrow the server's list, never extend it.
 *
 * Returns the resolved locations plus counts of what was rejected and why, so the caller can report a
 * partial import truthfully instead of claiming everything worked.
 */
export async function resolveSelectedLocations(session: AppSession, submittedIds: string[]): Promise<ResolveSelectionResult> {
  const pre = await preflight(session);
  if (!pre.ok) return { ok: false, reason: pre.reason };

  // Re-run discovery at IMPORT time, not just at render time: a location that was unverified, renamed or
  // removed since the page was drawn must be caught here.
  const discovery = await discoverGoogleBusinessScope(
    new GoogleBusinessApiClient({ transport: createGoogleFetchTransport(), accessToken: pre.token }),
  );
  if (!discovery.ok) return { ok: false, reason: "discovery_failed" };

  return { connectionId: pre.connectionId, ...matchSelection(discovery.accounts, discovery.locationsByAccount, submittedIds) };
}

/**
 * Pure matcher: intersect the submitted ids with the server's authorized, eligible locations.
 * Separated from the network so the whole security rule is deterministically testable.
 */
export function matchSelection(
  accounts: GoogleBusinessAccount[],
  locationsByAccount: Record<string, GoogleBusinessLocation[]>,
  submittedIds: string[],
): { ok: true; locations: ResolvedLocation[]; rejectedUnknown: number; rejectedIneligible: number } {
  // De-duplicate first so a repeated id in the form cannot inflate a count or cause a double import.
  const wanted = new Set(submittedIds.map((s) => String(s ?? "").trim()).filter(Boolean));
  const locations: ResolvedLocation[] = [];
  const matched = new Set<string>();
  let rejectedIneligible = 0;

  for (const acct of accounts) {
    for (const loc of locationsByAccount[acct.providerAccountId] ?? []) {
      if (!wanted.has(loc.providerLocationId) || matched.has(loc.providerLocationId)) continue;
      matched.add(loc.providerLocationId);
      // An unverified location is refused here even if the browser managed to submit it.
      if (!isLocationSyncEligible(loc)) { rejectedIneligible++; continue; }
      locations.push({ ...loc, providerAccountId: acct.providerAccountId });
    }
  }
  // Anything the server could not find is a forged, foreign or stale id. Counted, never acted on.
  return { ok: true, locations, rejectedUnknown: wanted.size - matched.size, rejectedIneligible };
}
