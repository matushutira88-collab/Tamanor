import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getGoogleBusinessConfig } from "@guardora/config";
import { buildGoogleAuthUrl, GOOGLE_BUSINESS_AUDIT } from "@guardora/sync";
import { Permission, can } from "@guardora/core";
import { getSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gbp_oauth_state";

/**
 * V1.36 — begin the Google Business Profile OAuth flow. Fail-closed: if config
 * is missing or the API is not enabled, redirect back with a truthful state and
 * NEVER a fake connection. Scope is limited to business.manage.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  if (!can(session.role, Permission.ConnectorManage)) {
    return NextResponse.redirect(new URL("/dashboard/accounts?google=denied", req.url));
  }

  const cfg = getGoogleBusinessConfig();
  if (!cfg.configured) return NextResponse.redirect(new URL("/dashboard/accounts?google=not_configured", req.url));
  if (!cfg.apiEnabled) return NextResponse.redirect(new URL("/dashboard/accounts?google=api_disabled", req.url));

  const stateToken = randomUUID();
  const jar = await cookies();
  jar.set(STATE_COOKIE, stateToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const url = buildGoogleAuthUrl({ clientId: cfg.clientId!, redirectUri: cfg.redirectUri!, state: stateToken });

  await writeAudit({
    session,
    event: GOOGLE_BUSINESS_AUDIT.connected,
    targetType: "connector",
    targetId: "google_business",
    metadata: { platform: "google_business", stage: "oauth_started" },
  });

  return NextResponse.redirect(url);
}
