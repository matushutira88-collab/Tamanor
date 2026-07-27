import { NextResponse, type NextRequest } from "next/server";
import { policyVersionAction } from "@/server/child-safety/policy";

/**
 * POST a version lifecycle/inspection action: { action: validate | simulate | submit | approve | reject |
 * activate, ... }. Same-origin required; each action re-checks its own permission (validate/simulate are
 * read-like but still same-origin; two-person control + immutability are enforced in the service).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ versionId: string }> }): Promise<NextResponse> {
  const { versionId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const r = await policyVersionAction(versionId, body);
  return NextResponse.json(r.body, { status: r.status });
}
