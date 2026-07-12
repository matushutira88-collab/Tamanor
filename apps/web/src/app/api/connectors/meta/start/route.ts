import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getMetaConfig } from "@guardora/config";
import { buildMetaAuthUrl } from "@guardora/connectors";
import { Permission, can } from "@guardora/core";
import { withTenant } from "@guardora/db";
import { getSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "meta_oauth_state";

/**
 * Begin the Meta OAuth flow. If credentials are not configured, redirect back
 * with a clear `config_missing` state — never a fake connection.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  // Only roles that can manage connectors may start OAuth.
  if (!can(session.role, Permission.ConnectorManage)) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?meta=denied", req.url),
    );
  }

  const meta = getMetaConfig();
  const brandId = req.nextUrl.searchParams.get("brandId") ?? "";
  // Optional reconnect context: the existing account being re-authorized.
  const reconnectAccountId = req.nextUrl.searchParams.get("accountId") ?? "";

  if (!meta.configured) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?meta=config_missing", req.url),
    );
  }

  // Tenant from the validated SESSION (never from the query). RLS re-validates the
  // brand belongs to this tenant; a foreign brandId reads back as not found.
  const brand = await withTenant(session.tenantId, (db) => db.brand.findFirst({
    where: { id: brandId, tenantId: session.tenantId },
    select: { id: true },
  }));
  if (!brand) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?meta=bad_brand", req.url),
    );
  }

  const stateToken = randomUUID();
  const jar = await cookies();
  // state cookie: token:brandId:accountId (accountId optional, for reconnect).
  jar.set(STATE_COOKIE, `${stateToken}:${brandId}:${reconnectAccountId}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const url = buildMetaAuthUrl(
    { appId: meta.appId!, redirectUri: meta.redirectUri! },
    { state: stateToken, scopes: meta.scopes },
  );

  await writeAudit({
    session,
    event: reconnectAccountId ? "oauth.reconnect_started" : "oauth.started",
    brandId,
    targetType: "connector",
    targetId: reconnectAccountId ? `account:${reconnectAccountId}` : `meta:${brandId}`,
    metadata: { platform: "meta", reconnect: Boolean(reconnectAccountId) },
  });

  return NextResponse.redirect(url);
}
