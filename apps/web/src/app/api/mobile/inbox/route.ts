import { NextResponse, type NextRequest } from "next/server";
import { handleInboxList } from "@/server/mobile-inbox";
import { realInboxDeps } from "@/server/mobile-inbox-deps";

/**
 * M4 — GET /api/mobile/inbox. Keyset-paginated, server-filtered Inbox for the native
 * client. Every query parameter is parsed and validated in `@/server/mobile-inbox`;
 * the tenant and user come from the validated bearer session, never the request.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const result = await handleInboxList(
    { authorization: req.headers.get("authorization"), get: (key) => params.get(key) },
    realInboxDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
