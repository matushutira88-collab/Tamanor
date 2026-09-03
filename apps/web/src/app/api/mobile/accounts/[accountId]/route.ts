import { NextResponse, type NextRequest } from "next/server";
import { handleAccountDetail } from "@/server/mobile-accounts";
import { realAccountsDeps } from "@/server/mobile-accounts-deps";

/**
 * M6 — GET /api/mobile/accounts/:accountId. Tenant-qualified: a foreign account is
 * indistinguishable from a missing one, so the response never confirms that another
 * tenant's id exists.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await ctx.params;
  const result = await handleAccountDetail(
    { authorization: req.headers.get("authorization"), accountId },
    realAccountsDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
