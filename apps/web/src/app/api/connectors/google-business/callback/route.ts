import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getGoogleBusinessConfig } from "@guardora/config";
import {
  validateOAuthState, exchangeGoogleAuthCode, discoverGoogleBusinessScope,
  GoogleBusinessApiClient, createGoogleFetchTransport, GOOGLE_BUSINESS_AUDIT,
} from "@guardora/sync";
import { persistGoogleBusinessGrant, activateGoogleBusinessConnection, BusinessConnectionStatus } from "@guardora/db";
import { Permission, can } from "@guardora/core";
import { getSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gbp_oauth_state";
// The full `google=<state>` literal is kept at every call site so the redirect vocabulary stays
// greppable in one pass — the existing connector test asserts these literals against this source.
const BACK = "/dashboard/accounts?";

/**
 * V1.36 / SLICE 1 — Google Business Profile OAuth callback.
 *
 * The flow, in fail-closed order. Every early return is a TRUTHFUL state; none of them creates or
 * promotes a connection, and none exposes a token, a client secret, or a raw provider error:
 *
 *   session missing            → /login
 *   ConnectorManage missing    → denied
 *   provider returned `error`  → oauth_denied            (user cancelled, or Google refused)
 *   state invalid/missing/replayed → invalid_state       (the cookie is single-use: deleted on arrival)
 *   no `code`                  → invalid_callback        (malformed callback)
 *   config incomplete          → not_configured
 *   GOOGLE_BUSINESS_API_ENABLED false   → api_disabled
 *   GOOGLE_BUSINESS_API_APPROVED false  → api_access_unconfirmed
 *   token exchange failed / no refresh token → exchange_failed
 *   vault or connection write failed         → connection_failed
 *   discovery failed                         → discovery_failed
 *   otherwise                  → connected
 *
 * THE CONNECTION IS PROMOTED LAST. Storing the credential and claiming to be connected are two separate
 * calls, and the second one sits AFTER discovery. Everything before it — exchange, vault write, vault
 * verification, account discovery, location discovery, normalization — runs with the connection still in
 * its non-active state (`pending` for a tenant connecting for the first time). So a discovery failure
 * cannot leave a connection asserting it is live: the code that would make it live is never reached.
 * A reconnect for a tenant that was ALREADY active is never downgraded by this route — its prior working
 * credential set was replaced only after the new one verified.
 *
 * THE TWO AXES STAY INDEPENDENT AND ARE BOTH CHECKED BEFORE ANY NETWORK CALL. `API_ENABLED` is our
 * kill switch; `API_APPROVED` records that Google has actually approved Business Profile API access for
 * the project. Neither substitutes for the other, and while approval is unconfirmed no authorization code
 * is exchanged and no credential is stored at all — the honest `api_access_unconfirmed` state is kept.
 *
 * SECRETS: `GOOGLE_BUSINESS_CLIENT_SECRET` is read from the server runtime here and passed straight into
 * the exchange. The code, the secret and both tokens never reach a redirect URL, an audit record, a log
 * line, or the browser. Audit metadata carries only bounded stage/outcome labels and counts.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  if (!can(session.role, Permission.ConnectorManage)) {
    return NextResponse.redirect(new URL(`${BACK}google=denied`, req.url));
  }

  // Single-use state: read and delete BEFORE any validation, so a replayed callback finds no cookie and
  // fails `validateOAuthState` exactly as a forged one does.
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const received = req.nextUrl.searchParams.get("state");
  const providerError = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");

  const fail = async (state: string, stage: string) => {
    await writeAudit({
      session,
      event: GOOGLE_BUSINESS_AUDIT.syncFailed,
      targetType: "connector",
      targetId: "google_business",
      metadata: { platform: "google_business", stage, outcome: state },
    }).catch(() => { /* auditing a failure must not mask it */ });
    return NextResponse.redirect(new URL(`${BACK}${state}`, req.url));
  };

  // User cancelled or Google returned an error — never expose the raw error.
  if (providerError) return fail("google=oauth_denied", "oauth_callback");
  if (!validateOAuthState(received, expected)) return fail("google=invalid_state", "oauth_callback");
  // A callback that carries valid state but no authorization code is malformed; there is nothing to exchange.
  if (!code) return fail("google=invalid_callback", "oauth_callback");

  const cfg = getGoogleBusinessConfig();
  if (!cfg.configured) return fail("google=not_configured", "config");
  if (!cfg.apiEnabled) return fail("google=api_disabled", "config");
  if (!cfg.apiApproved) return fail("google=api_access_unconfirmed", "config");

  // --- Server-side authorization-code exchange. Exact env contract; secret read only here.
  const exchanged = await exchangeGoogleAuthCode({
    code,
    clientId: cfg.clientId!,
    clientSecret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET!,
    redirectUri: cfg.redirectUri!,
  });
  // Covers: HTTP failure, invalid_grant, malformed body, MISSING REFRESH TOKEN, and a grant whose scopes
  // do not include business.manage. `exchanged.reason` is a bounded label; it is not put in the URL.
  if (!exchanged.ok || !exchanged.credentials) return fail("google=exchange_failed", "token_exchange");
  const credentials = exchanged.credentials;

  // --- Vault-backed persistence anchored on the existing per-tenant connection. This writes and verifies
  // the credential ONLY; it cannot promote anything, and a new tenant's connection stays `pending`.
  const persisted = await persistGoogleBusinessGrant({
    tenantId: session.tenantId,
    credentials,
  });
  if (!persisted.ok) return fail("google=connection_failed", "credential_persist");

  // --- Live discovery of what the grant actually authorises, through the existing client + normalizers.
  const discovery = await discoverGoogleBusinessScope(
    new GoogleBusinessApiClient({ transport: createGoogleFetchTransport(), accessToken: credentials.accessToken }),
  );
  // Fail-closed WITHOUT promotion: the credential stays safely encrypted in the vault, and the connection
  // is left exactly as it was — `pending` for a new tenant, untouched for an existing one.
  if (!discovery.ok) return fail("google=discovery_failed", "discovery");

  // --- Only now, with a verified credential AND proven discovery, may the connection claim to be live.
  const activated = await activateGoogleBusinessConnection({
    tenantId: session.tenantId,
    connectionId: persisted.connectionId,
    status: BusinessConnectionStatus.active,
  });
  if (!activated.ok) return fail("google=connection_failed", "activation");

  await writeAudit({
    session,
    event: GOOGLE_BUSINESS_AUDIT.connected,
    targetType: "connector",
    targetId: "google_business",
    // Counts and stage labels only — no account names, no location names, no token material.
    metadata: {
      platform: "google_business",
      stage: "oauth_completed",
      accountCount: discovery.accounts.length,
      eligibleLocationCount: discovery.eligibleLocationCount,
    },
  }).catch(() => { /* the connection is real whether or not the audit write succeeds */ });

  // Slice 2 owns account/location SELECTION and import; Slice 1 stops at a verified, credentialed
  // connection plus the normalized discovery it just proved.
  return NextResponse.redirect(new URL(`${BACK}google=connected`, req.url));
}
