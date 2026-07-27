import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth";
import { systemDb, analyticsExportCsv } from "@guardora/db";

/** Platform analytics CSV export — GET /api/platform/analytics/export. Requires the SEPARATE analytics.export
 *  capability (owner/admin) AND recent authentication; audited in the service. Aggregated metrics only (no raw
 *  identifiers). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !session.emailVerified) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const us = await systemDb.userSession.findUnique({ where: { id: session.sessionId }, select: { createdAt: true } }).catch(() => null);
  const p = req.nextUrl.searchParams;
  const dimension = p.get("dimension") ?? "path";
  try {
    const csv = await analyticsExportCsv(session.userId, dimension, us?.createdAt ?? null, { from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, includeBots: p.get("includeBots") === "1" });
    return new NextResponse(csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="analytics-${dimension}.csv"`, "cache-control": "no-store" } });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "platform_forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    if (code === "stale_privileged_auth") return NextResponse.json({ ok: false, error: "reauth_required" }, { status: 401 });
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
