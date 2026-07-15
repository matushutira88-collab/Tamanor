import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { resolveOAuthLogin, OAuthEmailRequiredError, type OAuthProvider } from "@guardora/db";
import { metrics, emitOpsEvent } from "@guardora/core";
import { startSessionInJar, type CookieJar } from "@/server/session-core";
import { authLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { getProviderConfig, resolveRedirectUri } from "./config";
import {
  randomToken, pkceChallenge, safeEqual, buildAuthorizeUrl, exchangeCode, fetchProfile,
  setTxnCookie, readTxnCookie, clearTxnCookie, type OAuthMode,
} from "./flow";

/**
 * V1.50B — provider-agnostic OAuth route handlers for USER login. `start` initiates the
 * authorize round-trip (state + PKCE, bound to an httpOnly cookie); `callback` validates
 * state, exchanges the code, reads the profile, resolves it to a single Tamanor identity,
 * and opens a session. Unconfigured providers degrade truthfully (never fake a login).
 */

/** GET /api/auth/{provider}/start */
export function startHandler(provider: OAuthProvider) {
  return async function GET(req: NextRequest): Promise<NextResponse> {
    const origin = req.nextUrl.origin;
    const mode: OAuthMode = req.nextUrl.searchParams.get("mode") === "register" ? "register" : "login";
    const back = (code: string) => NextResponse.redirect(new URL(`/${mode}?error=${code}`, origin));

    const ip = ipKeyFromHeader(req.headers.get("x-forwarded-for"));
    if (!authLimiter.check(`oauth:${ip}`).allowed) {
      metrics.inc("auth_rate_limited_total", { operation: "oauth_start" });
      return back("rate_limited");
    }

    const cfg = getProviderConfig(provider);
    if (!cfg) return back("oauth_unavailable"); // truthful until the env vars are configured

    const redirectUri = resolveRedirectUri(cfg, origin);
    const state = randomToken(32);
    const verifier = randomToken(48);
    const challenge = pkceChallenge(verifier);
    const res = NextResponse.redirect(buildAuthorizeUrl(cfg, { state, challenge, redirectUri }));
    setTxnCookie(res, provider, { state, verifier, mode });
    return res;
  };
}

/** GET /api/auth/{provider}/callback */
export function callbackHandler(provider: OAuthProvider) {
  return async function GET(req: NextRequest): Promise<NextResponse> {
    const origin = req.nextUrl.origin;
    const txn = readTxnCookie(req, provider);
    const mode: OAuthMode = txn?.mode ?? "login";
    const fail = (code: string) => {
      const r = NextResponse.redirect(new URL(`/${mode}?error=${code}`, origin));
      clearTxnCookie(r, provider);
      return r;
    };

    const params = req.nextUrl.searchParams;
    if (params.get("error")) return fail("oauth_denied");

    const code = params.get("code");
    const state = params.get("state");
    // CSRF: the returned state must equal the one bound to THIS browser's txn cookie.
    if (!txn || !code || !state || !safeEqual(state, txn.state)) return fail("oauth_state");

    const cfg = getProviderConfig(provider);
    if (!cfg) return fail("oauth_unavailable");
    const redirectUri = resolveRedirectUri(cfg, origin);

    let profile;
    try {
      const { accessToken } = await exchangeCode(cfg, { code, verifier: txn.verifier, redirectUri });
      profile = await fetchProfile(cfg, accessToken);
    } catch {
      emitOpsEvent("web.5xx", { operation: "oauth_callback", reason: "exchange_or_profile" });
      return fail("oauth_exchange");
    }

    let result;
    try {
      result = await resolveOAuthLogin({
        provider,
        providerAccountId: profile.providerAccountId,
        email: profile.email,
        emailVerified: profile.emailVerified,
        name: profile.name,
      });
    } catch (e) {
      if (e instanceof OAuthEmailRequiredError) return fail("oauth_email");
      emitOpsEvent("web.5xx", { operation: "oauth_callback", reason: "resolve" });
      return fail("oauth_failed");
    }

    const res = NextResponse.redirect(new URL(result.isNew ? "/onboarding" : "/dashboard", origin));
    try {
      // A NextResponse cookie jar satisfies the CookieJar contract → attaches Set-Cookie.
      await startSessionInJar(res.cookies as unknown as CookieJar, result.userId);
    } catch {
      return fail("oauth_session");
    }
    clearTxnCookie(res, provider);
    metrics.inc("auth_login_total", { operation: `oauth_${provider}`, result: result.isNew ? "registered" : "ok" });
    return res;
  };
}
