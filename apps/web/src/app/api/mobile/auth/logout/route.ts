import { NextResponse, type NextRequest } from "next/server";
import { handleMobileLogout } from "@/server/mobile-auth";
import { realMobileAuthDeps } from "@/server/mobile-auth-deps";

/**
 * M2 — POST /api/mobile/auth/logout. Revokes the presented `UserSession`
 * server-side (idempotent). Logging out is never "just delete the local token":
 * the token stops working for everyone the moment this succeeds.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const result = await handleMobileLogout(
    { authorization: req.headers.get("authorization") },
    realMobileAuthDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
