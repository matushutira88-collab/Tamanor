import { NextResponse, type NextRequest } from "next/server";
import { analyticsCsv } from "@/server/child-safety/analytics";

/**
 * Child Safety Analytics CSV export — GET /api/v1/child-safety/reviewer/analytics/export.
 * Returns a deterministic CSV of AGGREGATED metrics ONLY (overview, distributions, time series,
 * performance medians, reviewer workload as opaque positional labels). NEVER an incident id, user id,
 * guardian, note, message, evidence, or storage key. Elevated: Owner / Administrator only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const r = await analyticsCsv(req.nextUrl.searchParams);
  if (r.status !== 200 || !r.csv) return NextResponse.json({ ok: false, error: r.error ?? "internal" }, { status: r.status });
  return new NextResponse(r.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${r.filename}"`,
      "cache-control": "no-store",
    },
  });
}
