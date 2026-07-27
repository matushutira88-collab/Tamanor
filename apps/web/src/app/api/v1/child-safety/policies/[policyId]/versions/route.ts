import { NextResponse, type NextRequest } from "next/server";
import { policyVersionCreate } from "@/server/child-safety/policy";

/** POST a new DRAFT version of a policy (next version number). Same-origin + manage permission. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ policyId: string }> }): Promise<NextResponse> {
  const { policyId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const r = await policyVersionCreate(policyId, body);
  return NextResponse.json(r.body, { status: r.status });
}
