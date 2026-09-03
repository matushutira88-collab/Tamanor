import { NextResponse, type NextRequest } from "next/server";
import { handleOAuthStart } from "@/server/mobile-oauth";
import { realOAuthDeps } from "@/server/mobile-oauth-deps";

/**
 * M7 — POST /api/mobile/oauth/start. Begin a provider authorization from the phone.
 *
 * The bearer resolves the SAME `UserSession` a browser cookie would, so user,
 * tenant, role and sessionId all come from the server. The body carries only a
 * provider, an intent and a target id — and the target is re-validated against the
 * session's tenant before anything is created.
 *
 * The reply's `authorizationUrl` is the PROVIDER's URL, built server-side. It never
 * carries a Tamanor bearer, session token or client secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // A malformed body is an invalid request, never a crash.
  const body = await req.json().catch(() => null);
  const result = await handleOAuthStart(
    { authorization: req.headers.get("authorization"), body },
    realOAuthDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
