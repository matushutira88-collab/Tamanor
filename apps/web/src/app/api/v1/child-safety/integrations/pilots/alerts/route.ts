import { NextResponse, type NextRequest } from "next/server";
import { pilotAlerts } from "@/server/child-safety/partner-pilot";

/** GET content-free operational alerts (paginated). view permission. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const r = await pilotAlerts(req.nextUrl.searchParams);
  return NextResponse.json(r.body, { status: r.status });
}
