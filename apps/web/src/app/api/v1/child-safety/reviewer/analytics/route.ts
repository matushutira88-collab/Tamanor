import { NextResponse, type NextRequest } from "next/server";
import { analyticsReport } from "@/server/child-safety/analytics";

/**
 * Child Safety Analytics V1 — GET /api/v1/child-safety/reviewer/analytics.
 * Aggregated, privacy-suppressed, tenant-scoped operational analytics computed entirely from canonical
 * tables over a bounded date range (query: from, to, granularity=day|week|month). Owner / Administrator /
 * Safety Reviewer only. Content-free (no ids-of-children / raw content / notes).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await analyticsReport(req.nextUrl.searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
