import { NextResponse, type NextRequest } from "next/server";
import { reviewerDashboard } from "@/server/child-safety/reviewer";

/**
 * Reviewer Workspace V1 — GET /api/v1/child-safety/reviewer/dashboard.
 * Operational summary computed entirely from canonical tables: open / escalated / critical / resolved
 * today, average response + resolution time, signals last 24h, guardian deliveries, top risk families.
 * Owner / Administrator / Safety Reviewer only. Content-free.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const result = await reviewerDashboard();
  return NextResponse.json(result.body, { status: result.status });
}
