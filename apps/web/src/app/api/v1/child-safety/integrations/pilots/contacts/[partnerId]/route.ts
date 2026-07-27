import { NextResponse, type NextRequest } from "next/server";
import { pilotContacts } from "@/server/child-safety/partner-pilot";

/** GET a partner's bounded, business-only operational contacts. review/manage roles only. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ partnerId: string }> }): Promise<NextResponse> {
  const { partnerId } = await ctx.params;
  const r = await pilotContacts(partnerId);
  return NextResponse.json(r.body, { status: r.status });
}
