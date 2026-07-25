import { NextResponse, type NextRequest } from "next/server";
import { reviewerAction } from "@/server/child-safety/reviewer";

/**
 * Reviewer Workspace V1 — POST /api/v1/child-safety/reviewer/incidents/[incidentId]/actions.
 * A single mutating endpoint for the review lifecycle: { action: "assign"|"unassign"|"note"|"status", ... }.
 * Same-origin (CSRF) + Owner / Administrator / Safety Reviewer manage permission (enforced in the server
 * module + service). Every action is audit-logged, append-only, and tenant-isolated.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }): Promise<NextResponse> {
  const { incidentId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await reviewerAction(incidentId, body);
  return NextResponse.json(result.body, { status: result.status });
}
