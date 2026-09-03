import { NextResponse, type NextRequest } from "next/server";
import { handleOAuthSelect } from "@/server/mobile-oauth";
import { realOAuthDeps } from "@/server/mobile-oauth-deps";

/**
 * M7 — POST /api/mobile/oauth/flows/:flowId/select. Apply the user's choice.
 *
 * Runs the SAME canonical connector services the dashboard Server Action runs —
 * entitlement limits, per-brand platform caps, the encrypted token vault, audit and
 * account persistence are not duplicated here. Every submitted id is re-validated
 * against the SERVER's discovered asset list, so a client can only ever narrow it.
 *
 * A second submit finds a terminal flow and is refused rather than importing twice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ flowId: string }> },
): Promise<NextResponse> {
  const { flowId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const result = await handleOAuthSelect(
    { authorization: req.headers.get("authorization"), flowId, body },
    realOAuthDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
