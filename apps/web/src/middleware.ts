import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "guardora_session";

/**
 * Lightweight route guard: presence check only (no DB — this runs on the edge).
 * Full session validation happens in `getSession()` inside server components.
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
