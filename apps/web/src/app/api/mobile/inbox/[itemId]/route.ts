import { NextResponse, type NextRequest } from "next/server";
import { handleInboxDetail } from "@/server/mobile-inbox";
import { realInboxDeps } from "@/server/mobile-inbox-deps";

/**
 * M4 — GET /api/mobile/inbox/[itemId]. Resolves strictly inside the session's tenant:
 * an item belonging to another tenant returns the SAME `not_found` as one that does
 * not exist, so the response never reveals that it exists elsewhere.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<NextResponse> {
  const { itemId } = await ctx.params;
  const result = await handleInboxDetail(
    { authorization: req.headers.get("authorization"), itemId },
    realInboxDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
