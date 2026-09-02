import { NextResponse, type NextRequest } from "next/server";
import { handleMobileBootstrap } from "@/server/mobile-shell";
import { realBootstrapDeps } from "@/server/mobile-shell-deps";

/**
 * M3 — GET /api/mobile/bootstrap. Server-authoritative app-shell context for the
 * native client: identity, workspace, access/billing state, usage, counters and the
 * server-derived navigation set.
 *
 * The route only marshals; the gate (valid session → verified email → BUSINESS
 * workspace) and every projection live in `@/server/mobile-shell`. Navigation data
 * in the response is a UX affordance only — each endpoint re-authorizes on its own.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await handleMobileBootstrap(
    { authorization: req.headers.get("authorization") },
    realBootstrapDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
