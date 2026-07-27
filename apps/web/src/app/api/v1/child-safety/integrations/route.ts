import { NextResponse, type NextRequest } from "next/server";
import { integrationList, integrationAction } from "@/server/child-safety/integration";

/** Integration management — GET (list partners/apps/installations) / POST (action dispatch). Session + same-origin. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const r = await integrationList();
  return NextResponse.json(r.body, { status: r.status });
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const r = await integrationAction(body);
  return NextResponse.json(r.body, { status: r.status });
}
