import { NextResponse, type NextRequest } from "next/server";
import { pilotGet } from "@/server/child-safety/partner-pilot";

/** GET one pilot's full detail (role-aware projection; sensitive fields withheld from view-only roles). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ pilotId: string }> }): Promise<NextResponse> {
  const { pilotId } = await ctx.params;
  const r = await pilotGet(pilotId);
  return NextResponse.json(r.body, { status: r.status });
}
