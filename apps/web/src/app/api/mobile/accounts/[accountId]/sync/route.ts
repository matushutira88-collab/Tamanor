import { NextResponse, type NextRequest } from "next/server";
import { handleAccountSync } from "@/server/mobile-accounts";
import { realAccountsDeps } from "@/server/mobile-accounts-deps";

/**
 * M6 — POST /api/mobile/accounts/:accountId/sync. Starts the canonical READ-ONLY
 * sync and returns immediately (202) with a bounded result key.
 *
 * NON-BLOCKING: the provider round trip is scheduled after the response, so the phone
 * never holds a connection open for it. NO MODERATION: the only provider operation
 * reachable from this route is reading.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await ctx.params;
  const result = await handleAccountSync(
    { authorization: req.headers.get("authorization"), accountId },
    realAccountsDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
