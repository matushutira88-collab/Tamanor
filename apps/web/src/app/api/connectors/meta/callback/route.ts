import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getMetaConfig } from "@guardora/config";
import {
  exchangeMetaCode,
  exchangeForLongLivedToken,
  discoverMetaAccounts,
  fetchMetaPermissions,
  MetaGraphError,
  type MetaPermissionsResult,
} from "@guardora/connectors";
import { emitOpsEvent } from "@guardora/core";
import { classifyMetaDiscoveryError, classifyMetaEmptyPages } from "@/server/oauth/meta-callback-classify";
import { encryptToken } from "@guardora/db";
import { getSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
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
 * V1.58.1 — safe, structured server-side diagnostics for the Meta OAuth callback.
 * NEVER contains an access token, authorization code, app secret, or a full request
 * URL — only failure classification + Meta's own (token-free) error metadata, so a
 * 307-that-fails is debuggable from the logs. Emitted at warn level.
 */
function logDiag(fields: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.warn("[meta-oauth]", JSON.stringify({ scope: "connectors/meta/callback", ...fields }));
}

/** Extract safe (token-free) fields from a Meta Graph error for logging + classification. */
function metaErrFields(err: unknown): {
  httpStatus?: number; metaCode?: number; metaSubcode?: number; metaType?: string;
  kind: string; fbtraceId?: string; metaMessage?: string;
} {
  if (err instanceof MetaGraphError) {
    const d = err.detail;
    return {
      httpStatus: d.status, metaCode: d.code, metaSubcode: d.subcode, metaType: d.type,
      kind: d.kind, fbtraceId: d.fbtraceId, metaMessage: d.metaMessage,
    };
  }
  return { kind: "generic" };
}

const safeErr = (err: unknown): string => (err instanceof Error ? err.message : "unknown_error");

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

  // Tenant from the validated SESSION; brandId comes from the server-set state
  // cookie (never a client query param) and is re-validated under RLS.
  const brand = await withTenant(session.tenantId, (db) => db.brand.findFirst({
    where: { id: brandId, tenantId: session.tenantId },
    select: { id: true, name: true },
  }));
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
    logDiag({ step: "token_exchange", ok: true });
  } catch (err) {
    // Safe-fail the whole onboarding — no account is created.
    logDiag({ step: "token_exchange", ok: false, message: safeErr(err) });
    await auditFail("token_exchange_failed");
    return fail(req, "token_exchange_failed");
  }

  // 1b) Permissions diagnostic (best-effort, non-fatal). `/me/permissions` is the
  //     authoritative record of what the user actually granted — Facebook Login for
  //     Business lets users decline individual permissions, and a declined/absent
  //     `pages_show_list` makes `/me/accounts` return an error or an empty list. This
  //     lets us distinguish a permission gap from a generic API error.
  let perms: MetaPermissionsResult = { granted: [], declined: [] };
  let permsOk = false;
  try {
    // Pass the app secret so the request carries appsecret_proof (Meta "Require App Secret").
    perms = await fetchMetaPermissions(token.accessToken, cfg.appSecret);
    permsOk = true;
    logDiag({ step: "me/permissions", ok: true, granted: perms.granted, declined: perms.declined });
  } catch (err) {
    logDiag({ step: "me/permissions", ok: false, ...metaErrFields(err) });
  }
  const hasPagesShowList = perms.granted.includes("pages_show_list");

  // 2) Account discovery (uses the long-lived user token + appsecret_proof).
  let pages;
  try {
    pages = await discoverMetaAccounts(token.accessToken, cfg.appSecret);
    logDiag({ step: "me/accounts", ok: true, accountsCount: pages.length });
  } catch (err) {
    // Distinguish a Meta API error (esp. a permission error) from a generic failure —
    // NEVER report "no pages"/"missing permission" for what is actually a generic API error.
    const f = metaErrFields(err);
    logDiag({ step: "me/accounts", ok: false, ...f });
    emitOpsEvent("oauth.discovery_failed", {
      platform: "meta", httpStatus: f.httpStatus, kind: f.kind, metaCode: f.metaCode, metaSubcode: f.metaSubcode,
    });
    const reason = classifyMetaDiscoveryError(f.kind, permsOk, hasPagesShowList);
    await auditFail(reason);
    return fail(req, reason);
  }
  if (pages.length === 0) {
    // Empty (HTTP 200) list: a genuine "no Pages" unless /me/permissions CONFIRMS pages_show_list
    // was declined/absent — never a false "missing permission" when we couldn't read permissions.
    const reason = classifyMetaEmptyPages(permsOk, hasPagesShowList);
    logDiag({ step: "me/accounts", ok: true, accountsCount: 0, reason, hasPagesShowList, permsOk });
    await auditFail(reason);
    return fail(req, reason);
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

  // Tenant write AFTER all provider HTTP has completed (read → fetch → write).
  // Token encryption + tenant isolation preserved exactly (encryptToken + withTenant).
  let onboardingId: string;
  try {
    onboardingId = (await withTenant(session.tenantId, async (db) => {
      const onboarding = await db.metaOnboardingSession.create({
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
        select: { id: true },
      });
      return onboarding.id;
    })) as string;
    logDiag({ step: "save", ok: true, accountsCount: pages.length });
  } catch (err) {
    logDiag({ step: "save", ok: false, message: safeErr(err) });
    await auditFail("save_failed");
    return fail(req, "save_failed");
  }

jar.set(ONBOARDING_COOKIE, onboardingId, {
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
