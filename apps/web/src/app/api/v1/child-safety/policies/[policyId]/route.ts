import { NextResponse, type NextRequest } from "next/server";
import { policyGet } from "@/server/child-safety/policy";

/** GET a single policy with its version history (immutable states flagged). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ policyId: string }> }): Promise<NextResponse> {
  const { policyId } = await ctx.params;
  const r = await policyGet(policyId);
  return NextResponse.json(r.body, { status: r.status });
}
