import { NextResponse, type NextRequest } from "next/server";
import { handleMobileDashboard } from "@/server/mobile-shell";
import { realDashboardDeps } from "@/server/mobile-shell-deps";

/**
 * M3 — GET /api/mobile/dashboard?timeframe=7|30|90. Read-only Business dashboard
 * data for the native client, aggregated server-side so the app never loads raw
 * comments to compute KPIs itself.
 *
 * The tenant is derived from the validated session; `timeframe` is the ONLY
 * client input and is normalized to the allowed set.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await handleMobileDashboard(
    {
      authorization: req.headers.get("authorization"),
      timeframe: req.nextUrl.searchParams.get("timeframe"),
    },
    realDashboardDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
