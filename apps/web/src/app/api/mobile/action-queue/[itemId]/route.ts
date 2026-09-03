import { NextResponse, type NextRequest } from "next/server";
import { handleQueueDetail } from "@/server/mobile-queue";
import { realQueueDeps } from "@/server/mobile-queue-deps";

/**
 * M5 — GET /api/mobile/action-queue/[itemId]. Resolves strictly inside the session's
 * tenant: an item belonging to another tenant returns the SAME `not_found` as one
 * that does not exist.
 *
 * Readiness and lifecycle come from PERSISTED execution history — this route makes
 * no provider request of any kind.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<NextResponse> {
  const { itemId } = await ctx.params;
  const result = await handleQueueDetail(
    { authorization: req.headers.get("authorization"), itemId },
    realQueueDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
