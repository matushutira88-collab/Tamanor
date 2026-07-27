import { NextResponse, type NextRequest } from "next/server";
import { policyList, policyCreate } from "@/server/child-safety/policy";

/** Child Safety Policy Engine V1 — GET (list policies) / POST (create policy + first draft). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const r = await policyList(req.nextUrl.searchParams);
  return NextResponse.json(r.body, { status: r.status });
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const r = await policyCreate(body);
  return NextResponse.json(r.body, { status: r.status });
}
