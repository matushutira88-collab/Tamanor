import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { requirePlatformCapability } from "@guardora/db";
import { probeGoogleEmailCredentials, resolveEmailConfig, emitSafeLog } from "@guardora/core";

/**
 * TEMPORARY OPERATOR DIAGNOSTIC — GET /api/platform/email-credential-probe
 *
 * WHY: production registration reaches /verify-email but no mail arrives, and telemetry only ever said
 * `refresh_failed` because the transport discarded Google's `error` field. A local test was useless
 * because `vercel env pull` redacts every Sensitive variable, so the real credentials have never
 * actually been exercised. This endpoint performs the OAuth refresh **inside the production runtime**,
 * where the real values exist, and reports one bounded reason.
 *
 * IT DOES EXACTLY ONE THING: a single POST to oauth2.googleapis.com/token with grant_type=refresh_token.
 *   · sends NO email                    · writes NO database row
 *   · mutates NO credential or env      · rotates nothing
 *   · returns NO client id/secret, refresh token, access token, error_description or raw provider body
 *
 * Authorization mirrors /api/platform/release: an authenticated, email-verified session that holds the
 * platform capability `system_health.view`. It is not reachable anonymously and carries no bypass.
 *
 * REMOVE THIS ROUTE once the failure is identified — see the report accompanying the change.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !session.emailVerified) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  try {
    await requirePlatformCapability(session.userId, "system_health.view");
  } catch {
    // Identical shape to an unauthenticated caller elsewhere in the platform API — no probing signal.
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // resolveEmailConfig reads GOOGLE_EMAIL_* from the RUNTIME env. Only its non-secret shape is reported.
  const cfg = resolveEmailConfig();
  const result = await probeGoogleEmailCredentials(cfg);

  // Bounded, non-secret operational record. `reason` is a closed union; nothing else is emitted.
  emitSafeLog({
    event: "email.credential_probe",
    severity: result.ok ? "info" : "error",
    routeTemplate: "/api/platform/email-credential-probe",
    outcome: result.reason,
  });

  return NextResponse.json(
    {
      ok: result.ok,
      // The single bounded classification — the whole point of the probe.
      reason: result.reason,
      // Non-secret configuration shape, so an operator can tell "misconfigured" from "rejected by Google"
      // without ever seeing a value. Booleans and a provider name only.
      config: {
        provider: cfg?.provider ?? null,
        senderDomain: cfg?.from?.includes("@") ? `@${cfg.from.split("@").pop()}` : null,
        hasClientId: Boolean(cfg?.google?.clientId),
        hasClientSecret: Boolean(cfg?.google?.clientSecret),
        hasRefreshToken: Boolean(cfg?.google?.refreshToken),
      },
    },
    { status: 200, headers: { "cache-control": "private, no-store" } },
  );
}
