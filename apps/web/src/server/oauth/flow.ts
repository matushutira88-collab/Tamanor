import "server-only";
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { OAuthProvider } from "@guardora/db";
import type { ProviderEndpoints } from "./config";

/**
 * V1.50B — hand-rolled, production OAuth 2.0 / OIDC mechanics for USER login (Google,
 * Facebook). CSRF is prevented by a random `state` bound to the initiating browser via an
 * httpOnly transaction cookie; PKCE (S256) is used where the provider supports it. No
 * provider access/refresh token is ever persisted — it is used once to read the profile.
 */

const TXN_MAX_AGE_S = 600; // 10 minutes to complete the round-trip
export type OAuthMode = "login" | "register";
export type OAuthTxn = { state: string; verifier: string; mode: OAuthMode };

const txnCookieName = (provider: OAuthProvider) => `tam_oauth_${provider}`;

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}
/** PKCE S256 code challenge from a verifier. */
export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}
/** Constant-time string compare (equal length required). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---- transaction cookie (state + PKCE verifier + mode) ---------------------

export function setTxnCookie(res: NextResponse, provider: OAuthProvider, txn: OAuthTxn): void {
  res.cookies.set(txnCookieName(provider), JSON.stringify(txn), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: TXN_MAX_AGE_S,
  });
}
export function readTxnCookie(req: NextRequest, provider: OAuthProvider): OAuthTxn | null {
  const raw = req.cookies.get(txnCookieName(provider))?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.state === "string" && typeof v?.verifier === "string" && (v?.mode === "login" || v?.mode === "register")) {
      return { state: v.state, verifier: v.verifier, mode: v.mode };
    }
  } catch {
    /* fall through */
  }
  return null;
}
export function clearTxnCookie(res: NextResponse, provider: OAuthProvider): void {
  res.cookies.set(txnCookieName(provider), "", {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth", maxAge: 0,
  });
}

// ---- authorize URL ---------------------------------------------------------

export function buildAuthorizeUrl(
  cfg: ProviderEndpoints,
  args: { state: string; challenge: string; redirectUri: string },
): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", args.state);
  if (cfg.usePkce) {
    u.searchParams.set("code_challenge", args.challenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  if (cfg.provider === "google") {
    // Request a stable refreshless login; prompt account selection.
    u.searchParams.set("prompt", "select_account");
  }
  return u.toString();
}

// ---- token exchange + profile ----------------------------------------------

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    // Never follow to an unexpected host; these are fixed provider endpoints.
    redirect: "manual",
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok || typeof json.access_token !== "string") {
    throw new Error(`oauth_token_exchange_failed:${resp.status}`);
  }
  return json;
}

export async function exchangeCode(
  cfg: ProviderEndpoints,
  args: { code: string; verifier: string; redirectUri: string },
): Promise<{ accessToken: string }> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code: args.code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: args.redirectUri,
  };
  if (cfg.usePkce) body.code_verifier = args.verifier;
  const json = await postForm(cfg.tokenUrl, body);
  return { accessToken: json.access_token as string };
}

export type OAuthProfile = { providerAccountId: string; email: string | null; emailVerified: boolean; name: string | null };

export async function fetchProfile(cfg: ProviderEndpoints, accessToken: string): Promise<OAuthProfile> {
  if (cfg.provider === "google") {
    const resp = await fetch(cfg.userInfoUrl, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
    if (!resp.ok) throw new Error(`oauth_userinfo_failed:${resp.status}`);
    const j = (await resp.json()) as Record<string, unknown>;
    const sub = String(j.sub ?? "");
    if (!sub) throw new Error("oauth_userinfo_no_sub");
    const email = typeof j.email === "string" ? j.email : null;
    const emailVerified = j.email_verified === true || j.email_verified === "true";
    return { providerAccountId: sub, email, emailVerified, name: typeof j.name === "string" ? j.name : null };
  }
  // Facebook: Graph /me with appsecret_proof (recommended), fields id,name,email.
  const proof = createHmac("sha256", cfg.clientSecret).update(accessToken).digest("hex");
  const u = new URL(cfg.userInfoUrl);
  u.searchParams.set("fields", "id,name,email");
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("appsecret_proof", proof);
  const resp = await fetch(u.toString(), { headers: { accept: "application/json" } });
  if (!resp.ok) throw new Error(`oauth_userinfo_failed:${resp.status}`);
  const j = (await resp.json()) as Record<string, unknown>;
  const id = String(j.id ?? "");
  if (!id) throw new Error("oauth_userinfo_no_id");
  const email = typeof j.email === "string" ? j.email : null;
  // Facebook only returns a verified email; treat presence as verified.
  return { providerAccountId: id, email, emailVerified: !!email, name: typeof j.name === "string" ? j.name : null };
}
