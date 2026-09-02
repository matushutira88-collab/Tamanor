import { NextResponse, type NextRequest } from "next/server";
import { handleMobileSession } from "@/server/mobile-auth";
import { realMobileAuthDeps } from "@/server/mobile-auth-deps";

/**
 * M2 — GET /api/mobile/auth/session. The authoritative session check for the native
 * app: full server-side validation (revocation, idle, absolute ceiling, membership,
 * passwordChangedAt) on every call. Identity is resolved from the `UserSession` row,
 * never from anything the client sends.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await handleMobileSession(
    { authorization: req.headers.get("authorization") },
    realMobileAuthDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
