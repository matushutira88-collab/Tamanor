import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";
import { handleAnalyticsIngest, consentModeFrom, ANALYTICS_VISITOR_COOKIE, ANALYTICS_SESSION_COOKIE, ANALYTICS_CONSENT_COOKIE } from "@/server/analytics/ingest-core";

/**
 * First-party privacy analytics ingestion — POST /api/analytics/events. Same-origin only, sendBeacon-friendly.
 * UA/IP are used transiently (coarse device/country) and NEVER persisted; visitor/session are server-derived,
 * keyed, rotating pseudonyms. Returns a SAFE generic response. Never trusts a client-selected tenant/user/hash.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWN_HOSTS = ["localhost", "127.0.0.1", "tamanor.com", "www.tamanor.com"] as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text().catch(() => "");
  const [sameOrigin, session] = await Promise.all([isSameOrigin().catch(() => false), getSession().catch(() => null)]);
  const consent = consentModeFrom(req.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value ?? req.headers.get("x-ta-consent"));
  const result = await handleAnalyticsIngest(rawBody, {
    sameOrigin,
    contentType: req.headers.get("content-type"),
    userAgent: req.headers.get("user-agent"),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null,
    visitorToken: req.cookies.get(ANALYTICS_VISITOR_COOKIE)?.value ?? null,
    sessionToken: req.cookies.get(ANALYTICS_SESSION_COOKIE)?.value ?? null,
    consent,
    authenticatedUserState: session ? "AUTHENTICATED" : "ANONYMOUS",
    tenantState: session?.tenantId ? "HAS_TENANT" : "NONE",
    ownHosts: OWN_HOSTS,
    now: new Date(),
  });
  const res = NextResponse.json(result.body, { status: result.status });
  for (const c of result.setCookies) {
    res.cookies.set(c.name, c.value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: c.maxAgeSec, path: "/" });
  }
  res.headers.set("cache-control", "no-store");
  return res;
}
