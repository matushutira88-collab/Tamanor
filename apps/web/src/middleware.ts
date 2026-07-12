import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "tamanor_session";

/**
 * V1.37.1 — UX redirect HINT ONLY. This is NOT a security barrier: the edge has
 * no DB, so it cannot validate the opaque session token (a present cookie may be
 * expired/revoked/forged). Real authentication is ALWAYS enforced server-side
 * via `requireSession()`/`getSession()` (→ validated `UserSession` row) in every
 * protected layout, page and server action. Middleware only saves an obviously
 * signed-out user a round-trip.
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
