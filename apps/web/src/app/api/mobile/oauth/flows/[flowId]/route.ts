import { NextResponse, type NextRequest } from "next/server";
import { handleOAuthStatus } from "@/server/mobile-oauth";
import { realOAuthDeps } from "@/server/mobile-oauth-deps";

/**
 * M7 — GET /api/mobile/oauth/flows/:flowId. THE authoritative answer.
 *
 * The deep link that woke the app proves nothing; this endpoint is the only thing
 * that may be believed. Ownership is checked on user, tenant AND the originating
 * UserSession, so another login — or another member of the same tenant — gets
 * `not_found` rather than a view of someone else's authorization.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ flowId: string }> },
): Promise<NextResponse> {
  const { flowId } = await ctx.params;
  const result = await handleOAuthStatus(
    { authorization: req.headers.get("authorization"), flowId },
    realOAuthDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
