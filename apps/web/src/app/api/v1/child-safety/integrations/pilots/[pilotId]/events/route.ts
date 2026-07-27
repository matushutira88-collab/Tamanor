import { NextResponse, type NextRequest } from "next/server";
import { pilotEvents } from "@/server/child-safety/partner-pilot";

/** GET the append-only, content-free pilot operational history (paginated). audit_view permission. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ pilotId: string }> }): Promise<NextResponse> {
  const { pilotId } = await ctx.params;
  const r = await pilotEvents(pilotId, req.nextUrl.searchParams);
  return NextResponse.json(r.body, { status: r.status });
}
