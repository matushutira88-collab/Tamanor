import { NextResponse, type NextRequest } from "next/server";
import { handleQueueList } from "@/server/mobile-queue";
import { realQueueDeps } from "@/server/mobile-queue-deps";

/**
 * M5 — GET /api/mobile/action-queue?tab=&cursor=. Keyset-paginated Action Queue for
 * the native client, using the canonical `queueTabStates` mapping.
 *
 * READ ONLY. The tenant comes from the validated bearer session; `tab` and `cursor`
 * are the only client inputs and both are normalized server-side.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const result = await handleQueueList(
    {
      authorization: req.headers.get("authorization"),
      tab: params.get("tab"),
      cursor: params.get("cursor"),
    },
    realQueueDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
