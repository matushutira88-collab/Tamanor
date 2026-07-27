import { NextResponse, type NextRequest } from "next/server";
import { policyVersionPatch } from "@/server/child-safety/policy";

/** PATCH — edit a DRAFT version's definition (immutable statuses rejected). Same-origin + manage. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ versionId: string }> }): Promise<NextResponse> {
  const { versionId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const r = await policyVersionPatch(versionId, body);
  return NextResponse.json(r.body, { status: r.status });
}
