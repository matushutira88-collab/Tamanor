import { NextResponse, type NextRequest } from "next/server";
import { ipKeyFromHeader } from "@/lib/rate-limit";
import { handleMobileLogin } from "@/server/mobile-auth";
import { realMobileAuthDeps } from "@/server/mobile-auth-deps";

/**
 * M2 — POST /api/mobile/auth/login. Native (bearer) login for the Tamanor mobile app.
 *
 * This route only marshals the request/response; every decision lives in
 * `@/server/mobile-auth`, which delegates credential checking to the SAME shared
 * core as the web Server Action. There is no CSRF/same-origin check here because a
 * bearer token is never attached automatically by a user agent — and correspondingly
 * no cookie is ever set by this route.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  const result = await handleMobileLogin(
    {
      body,
      ipKey: ipKeyFromHeader(forwardedFor),
      remoteIp: forwardedFor?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    },
    realMobileAuthDeps(),
  );

  // A login response carries the session token, so it must never be cached anywhere.
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
