import { NextResponse, type NextRequest } from "next/server";
import { handleOAuthCancel } from "@/server/mobile-oauth";
import { realOAuthDeps } from "@/server/mobile-oauth-deps";

/**
 * M7 — POST /api/mobile/oauth/flows/:flowId/cancel. Record that the user dismissed
 * the auth browser.
 *
 * The transition is one-way and server-authoritative: only a NON-terminal flow can
 * be cancelled, so a provider callback that lands afterwards finds a terminal row
 * and is refused. A late success can never resurrect a cancelled authorization.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ flowId: string }> },
): Promise<NextResponse> {
  const { flowId } = await ctx.params;
  const result = await handleOAuthCancel(
    { authorization: req.headers.get("authorization"), flowId },
    realOAuthDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
