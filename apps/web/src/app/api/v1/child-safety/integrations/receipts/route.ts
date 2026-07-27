import { NextResponse, type NextRequest } from "next/server";
import { integrationReceipts } from "@/server/child-safety/integration";

/** GET the append-only, content-free signal receipts (paginated). receipts_view permission. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const r = await integrationReceipts(req.nextUrl.searchParams);
  return NextResponse.json(r.body, { status: r.status });
}
