import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getMetaConfig } from "@guardora/config";
import { getSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { writeAudit } from "@/server/audit";
import { runMetaOAuthExchange } from "@/server/oauth/meta-oauth-service";
import {
  tryResolveMobileFlow, markSelectionRequired, failMobileFlow, mobileCallbackUrl,
  type MobileCallbackFailure,
} from "@/server/oauth/mobile-callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "meta_oauth_state";
const ONBOARDING_COOKIE = "meta_onboarding";
const ONBOARDING_TTL_MS = 10 * 60 * 1000;

function fail(req: NextRequest, reason: string) {
  return NextResponse.redirect(
    new URL(`/dashboard/accounts?meta=${reason}`, req.url),
  );
}

/**
 * Meta OAuth callback — ONE HTTPS endpoint serving BOTH transports.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHICH BRANCH, AND WHY IN THIS ORDER.
 *
 * A mobile authorization arrives with no Tamanor cookie at all, so the first thing
 * this route does — before any cookie is read — is hash the provider's `state` and
 * look for a `ConnectorOAuthFlow`. That lookup is also the replay guard: it
 * atomically consumes the state, so a redelivered callback finds it spent.
 *
 * A WEB `state` is a `randomUUID` that was never written to that table, so the
 * lookup finds nothing, returns `not_mobile`, and execution falls through to the
 * original cookie path — unchanged, including its exact redirect vocabulary.
 *
 * Both branches then run the SAME `runMetaOAuthExchange`: identical token exchange,
 * permissions read, discovery, classification and encrypted onboarding write.
 * Neither branch owns a private copy of the provider pipeline.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * NO ACCOUNT IS CREATED HERE, on either branch. Discovery lands in a short-lived
 * onboarding session and the user then selects; a Meta grant is an authorization,
 * not a connection.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error");

  /* ------------------------------------------------------------- MOBILE ---- */
  const mobile = await tryResolveMobileFlow({ rawState: state, provider: "meta" });

  if (mobile.kind === "rejected") {
    // A replayed, expired, mismatched or logged-out flow. The app is sent home with
    // a correlation id ONLY; it will read the authoritative status itself.
    return mobile.flowId
      ? NextResponse.redirect(mobileCallbackUrl(mobile.flowId))
      : fail(req, "invalid_state");
  }

  if (mobile.kind === "resolved") {
    const flow = mobile.flow;
    // Every mobile exit is the SAME deep link: a correlation id and nothing else.
    // The outcome is deliberately not encoded here — the app reads it from the
    // authenticated status endpoint, which is the only authority.
    const done = () =>
      NextResponse.redirect(mobileCallbackUrl(flow.id), {
        status: 302,
        headers: { "Cache-Control": "no-store" },
      });

    // Identity comes ENTIRELY from the stored flow. Nothing the browser sent is
    // treated as authority — not a tenant, a user, a brand or a role.
    const auditSession = { tenantId: flow.tenantId, userId: flow.userId };
    const auditFail = async (reason: string) => {
      await writeAudit({
        session: auditSession, event: "oauth.failed",
        brandId: flow.brandId ?? undefined, targetType: "connector", targetId: "meta",
        metadata: { platform: "meta", reason, surface: "mobile" },
      }).catch(() => {});
    };

    if (oauthError) {
      await auditFail("user_denied");
      await failMobileFlow(flow, "user_cancelled");
      return done();
    }
    if (!code) {
      await auditFail("invalid_state");
      await failMobileFlow(flow, "invalid_state");
      return done();
    }
    if (!flow.brandId) {
      await auditFail("bad_brand");
      await failMobileFlow(flow, "unknown");
      return done();
    }
    // The brand was validated at start; re-validate under RLS so a brand deleted
    // mid-authorization cannot be written to.
    const brand = await withTenant(flow.tenantId, (db) =>
      db.brand.findFirst({ where: { id: flow.brandId!, tenantId: flow.tenantId }, select: { id: true } }),
    );
    if (!brand) {
      await auditFail("bad_brand");
      await failMobileFlow(flow, "unknown");
      return done();
    }

    const result = await runMetaOAuthExchange({
      code, tenantId: flow.tenantId, userId: flow.userId, brandId: flow.brandId,
    });

    if (!result.ok) {
      await auditFail(result.reason);
      await failMobileFlow(flow, normalizeMetaFailure(result.reason));
      return done();
    }

    await writeAudit({
      session: auditSession, event: "oauth.completed",
      brandId: flow.brandId, targetType: "connector", targetId: "meta",
      metadata: { platform: "meta", surface: "mobile" },
    }).catch(() => {});
    await writeAudit({
      session: auditSession, event: "account.discovered",
      brandId: flow.brandId, targetType: "connector", targetId: "meta",
      metadata: {
        platform: "meta", surface: "mobile",
        pages: result.pageCount, withInstagram: result.withInstagram,
      },
    }).catch(() => {});

    // AUTHORIZED, NOT CONNECTED. The phone now fetches options and selects natively.
    await markSelectionRequired({ flow, resultRefId: result.onboardingId });
    return done();
  }

  /* ---------------------------------------------------------------- WEB ---- */
  // Unchanged from before M7: cookie session, cookie state, same redirects.
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const jar = await cookies();
  const stored = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

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

  const result = await runMetaOAuthExchange({
    code, tenantId: session.tenantId, userId: session.userId, brandId,
  });
  if (!result.ok) {
    await auditFail(result.reason);
    return fail(req, result.reason);
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
      pages: result.pageCount,
      withInstagram: result.withInstagram,
    },
  });

  jar.set(ONBOARDING_COOKIE, result.onboardingId, {
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

/**
 * Map the canonical web failure vocabulary onto the bounded mobile one.
 *
 * The web reasons are already bounded keys, but they are a redirect vocabulary; the
 * phone gets the smaller, stable set it localizes. Anything unrecognized becomes
 * `unknown` rather than travelling verbatim.
 */
function normalizeMetaFailure(reason: string): MobileCallbackFailure {
  switch (reason) {
    case "token_exchange_failed": return "token_exchange_failed";
    case "save_failed": return "save_failed";
    case "config_missing": return "provider_unavailable";
    case "oauth_denied": return "user_cancelled";
    case "invalid_state": return "invalid_state";
    case "no_pages":
    case "no_accounts": return "no_accounts";
    case "missing_permission":
    case "permission_missing": return "missing_permission";
    default: return "unknown";
  }
}
