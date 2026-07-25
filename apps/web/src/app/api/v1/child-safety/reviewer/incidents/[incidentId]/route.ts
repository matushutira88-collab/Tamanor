import { NextResponse, type NextRequest } from "next/server";
import { reviewerIncidentDetail } from "@/server/child-safety/reviewer";

/**
 * Reviewer Workspace V1 — GET /api/v1/child-safety/reviewer/incidents/[incidentId].
 * Full incident detail: incident + linked signals + deterministic timeline + escalations + internal
 * notifications + guardian delivery status + recovery status + audit references + execution ledger
 * summary + append-only reviewer notes. Owner / Administrator / Safety Reviewer only. Never exposes
 * detector payloads or raw content. Cross-tenant → 404 (never reveals existence in another tenant).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }): Promise<NextResponse> {
  const { incidentId } = await ctx.params;
  const result = await reviewerIncidentDetail(incidentId);
  return NextResponse.json(result.body, { status: result.status });
}
