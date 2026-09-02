import { NextResponse, type NextRequest } from "next/server";
import { handleInboxOptions } from "@/server/mobile-inbox";
import { realInboxDeps } from "@/server/mobile-inbox-deps";

/**
 * M4 — GET /api/mobile/inbox/options. Small, stable filter option data (platforms,
 * tenant labels, assignable members) served separately so it is fetched once instead
 * of riding on every page of the list. Members carry a display name only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await handleInboxOptions(
    { authorization: req.headers.get("authorization") },
    realInboxDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
