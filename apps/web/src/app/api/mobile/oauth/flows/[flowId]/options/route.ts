import { NextResponse, type NextRequest } from "next/server";
import { handleOAuthOptions } from "@/server/mobile-oauth";
import { realOAuthDeps } from "@/server/mobile-oauth-deps";

/**
 * M7 — GET /api/mobile/oauth/flows/:flowId/options. The Pages or locations the
 * user may choose, for a flow that is genuinely in `selection_required`.
 *
 * Every option is bounded and token-free: provider page tokens are stripped before
 * the projection is built, so no credential can reach the phone.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ flowId: string }> },
): Promise<NextResponse> {
  const { flowId } = await ctx.params;
  const result = await handleOAuthOptions(
    { authorization: req.headers.get("authorization"), flowId },
    realOAuthDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
