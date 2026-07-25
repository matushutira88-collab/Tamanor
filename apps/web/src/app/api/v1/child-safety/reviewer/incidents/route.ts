import { NextResponse, type NextRequest } from "next/server";
import { reviewerListIncidents } from "@/server/child-safety/reviewer";

/**
 * Reviewer Workspace V1 — GET /api/v1/child-safety/reviewer/incidents.
 * Paginated, sorted, filtered canonical child-safety incident list. Owner / Administrator / Safety
 * Reviewer only (session + permission enforced in the server module). Content-free.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await reviewerListIncidents(req.nextUrl.searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
