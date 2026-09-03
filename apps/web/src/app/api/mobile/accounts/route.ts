import { NextResponse, type NextRequest } from "next/server";
import { handleAccountsList } from "@/server/mobile-accounts";
import { realAccountsDeps } from "@/server/mobile-accounts-deps";

/**
 * M6 — GET /api/mobile/accounts. The tenant's connected accounts, capacity and
 * connector capability, from the canonical batched accounts overview.
 *
 * READ ONLY. The tenant, role and workspace all come from the validated bearer
 * session; the request carries no identity of its own.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await handleAccountsList(
    { authorization: req.headers.get("authorization") },
    realAccountsDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
