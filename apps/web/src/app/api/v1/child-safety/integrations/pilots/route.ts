import { NextResponse, type NextRequest } from "next/server";
import { pilotList, pilotAction } from "@/server/child-safety/partner-pilot";

/** Partner Pilot management — GET (list pilots) / POST (action dispatch). Session + same-origin (mutations). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const r = await pilotList(req.nextUrl.searchParams);
  return NextResponse.json(r.body, { status: r.status });
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const r = await pilotAction(body);
  return NextResponse.json(r.body, { status: r.status });
}
