import { NextResponse, type NextRequest } from "next/server";
import { handleOAuthProviders } from "@/server/mobile-oauth";
import { realOAuthDeps } from "@/server/mobile-oauth-deps";

/**
 * M7 — GET /api/mobile/oauth/providers. Which connectors this deployment can
 * actually start, plus the tenant's brands as connect targets.
 *
 * Availability is three booleans. No client id, redirect URI, scope list or any
 * other provider configuration crosses the wire: in this server-driven design the
 * phone never builds a provider URL, so it needs none of it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await handleOAuthProviders(
    { authorization: req.headers.get("authorization") },
    realOAuthDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
