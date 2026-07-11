import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getGoogleBusinessConfig } from "@guardora/config";
import { validateOAuthState } from "@guardora/sync";
import { getSession } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gbp_oauth_state";

/**
 * V1.36 — Google Business Profile OAuth callback. Validates state (CSRF), then —
 * until real GBP API access is approved and the token exchange is wired — reports
 * `api_access_unconfirmed` HONESTLY rather than faking a connection. No token or
 * raw provider error is ever placed in the URL/UI. When live access is approved,
 * the server-side code exchange + encrypted refresh-token storage are added here.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const received = req.nextUrl.searchParams.get("state");
  const providerError = req.nextUrl.searchParams.get("error");

  // User cancelled or Google returned an error — never expose the raw error.
  if (providerError) return NextResponse.redirect(new URL("/dashboard/accounts?google=oauth_denied", req.url));

  if (!validateOAuthState(received, expected)) {
    return NextResponse.redirect(new URL("/dashboard/accounts?google=invalid_state", req.url));
  }

  const cfg = getGoogleBusinessConfig();
  if (!cfg.configured) return NextResponse.redirect(new URL("/dashboard/accounts?google=not_configured", req.url));
  if (!cfg.apiEnabled) return NextResponse.redirect(new URL("/dashboard/accounts?google=api_disabled", req.url));

  // State is valid and config is present, but real Business Profile API access
  // (project approval + token exchange) is not yet wired — report honestly.
  return NextResponse.redirect(new URL("/dashboard/accounts?google=api_access_unconfirmed", req.url));
}
