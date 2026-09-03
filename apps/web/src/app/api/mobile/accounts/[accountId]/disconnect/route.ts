import { NextResponse, type NextRequest } from "next/server";
import { handleAccountDisconnect } from "@/server/mobile-accounts";
import { realAccountsDeps } from "@/server/mobile-accounts-deps";

/**
 * M6 — POST /api/mobile/accounts/:accountId/disconnect.
 *
 * Delegates to the canonical `disconnectAccount`: tenant-qualified read, token-sharing
 * cluster resolve, best-effort provider revoke outside any transaction, then atomic
 * local credential removal for the whole cluster. This route never nulls a token
 * column itself and never returns one. The reply carries a cluster COUNT and platform
 * keys — never internal account ids.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await ctx.params;
  const result = await handleAccountDisconnect(
    { authorization: req.headers.get("authorization"), accountId },
    realAccountsDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
