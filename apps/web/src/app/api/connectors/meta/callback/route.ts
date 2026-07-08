import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getMetaConfig } from "@guardora/config";
import {
  exchangeMetaCode,
  exchangeForLongLivedToken,
  discoverMetaAccounts,
} from "@guardora/connectors";
import { encryptToken } from "@guardora/db";
import { getSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "meta_oauth_state";
const ONBOARDING_COOKIE = "meta_onboarding";
const ONBOARDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

function fail(req: NextRequest, reason: string) {
  return NextResponse.redirect(
    new URL(`/dashboard/accounts?meta=${reason}`, req.url),
  );
}

/**
 * OAuth callback. Validates CSRF state, exchanges the code, discovers Pages/IG
 * accounts, and stores the result in a short-lived onboarding session, then
 * redirects to the Page selection screen. It NEVER creates a ConnectedAccount
 * here and NEVER creates a fake "connected" state on error. Tokens are never
 * logged or written to audit.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const jar = await cookies();
  const stored = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error");

  const meta = getMetaConfig();
  const [stateToken, brandId] = (stored ?? "").split(":");

  const auditFail = async (reason: string) => {
    await writeAudit({
      session,
      event: "oauth.failed",
      brandId: brandId || undefined,
      targetType: "connector",
      targetId: "meta",
      metadata: { platform: "meta", reason },
    });
  };

  if (oauthError) {
    await auditFail("user_denied");
    return fail(req, "oauth_denied");
  }
  if (!meta.configured) return fail(req, "config_missing");
  if (!code || !state || !stored || !brandId || state !== stateToken) {
    await auditFail("invalid_state");
    return fail(req, "invalid_state");
  }

  const brand = await prisma.brand.findFirst({
    where: { id: brandId, tenantId: session.tenantId },
    select: { id: true, name: true },
  });
  if (!brand) {
    await auditFail("bad_brand");
    return fail(req, "bad_brand");
  }

  const cfg = {
    appId: meta.appId!,
    appSecret: meta.appSecret!,
    redirectUri: meta.redirectUri!,
  };

  // 1) Short-lived token exchange, then upgrade to a long-lived token (~60d).
  let token;
  try {
    const shortLived = await exchangeMetaCode(cfg, code);
    token = await exchangeForLongLivedToken(cfg, shortLived.accessToken);
  } catch {
    // Safe-fail the whole onboarding — no account is created.
    await auditFail("token_exchange_failed");
    return fail(req, "token_exchange_failed");
  }

  // 2) Account discovery (uses the long-lived user token).
  let pages;
  try {
    pages = await discoverMetaAccounts(token.accessToken);
  } catch {
    await auditFail("discovery_failed");
    return fail(req, "discovery_failed");
  }
  if (pages.length === 0) {
    await auditFail("no_pages");
    return fail(req, "no_pages");
  }

  await writeAudit({
    session,
    event: "oauth.completed",
    brandId,
    targetType: "connector",
    targetId: "meta",
    metadata: { platform: "meta" },
  });
  await writeAudit({
    session,
    event: "account.discovered",
    brandId,
    targetType: "connector",
    targetId: "meta",
    metadata: {
      platform: "meta",
      pages: pages.length,
      withInstagram: pages.filter((p) => p.igBusinessId).length,
    },
  });

  // 3) Persist discovery to a short-lived onboarding session (server-only tokens)
  const expiresAt = token.expiresInSeconds
    ? new Date(Date.now() + token.expiresInSeconds * 1000)
    : null;

  const onboarding = await prisma.metaOnboardingSession.create({
    data: {
      tenantId: session.tenantId,
      brandId,
      userId: session.userId,
      // Encrypted at the storage seam (dev: tagged plaintext; prod: KMS).
      userAccessToken: encryptToken(token.accessToken),
      tokenType: token.tokenType,
      tokenExpiresAt: expiresAt,
      // The scopes actually requested for this flow (env-driven, safe default).
      grantedScopes: meta.scopes,
      pages: pages as never,
      expiresAt: new Date(Date.now() + ONBOARDING_TTL_MS),
    },
  });

  jar.set(ONBOARDING_COOKIE, onboarding.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONBOARDING_TTL_MS / 1000,
  });

  return NextResponse.redirect(
    new URL("/dashboard/accounts/meta/select", req.url),
  );
}
