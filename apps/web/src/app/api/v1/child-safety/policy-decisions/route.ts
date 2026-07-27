import { NextResponse, type NextRequest } from "next/server";
import { policyDecisions } from "@/server/child-safety/policy";

/** GET the append-only, content-free policy decision history (paginated). decision_view permission. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const r = await policyDecisions(req.nextUrl.searchParams);
  return NextResponse.json(r.body, { status: r.status });
}
