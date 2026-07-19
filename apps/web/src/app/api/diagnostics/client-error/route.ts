import { NextResponse, type NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { isSameOrigin } from "@/server/csrf";
import { diagnosticsLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { summarizeUserAgent } from "@/server/auth-security";
import { handleClientErrorReport } from "@/server/diagnostics/client-error-sink";
import { TRACE_COOKIE, readValidTraceId } from "@/server/diagnostics/login-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 2048;

/**
 * V1.63 — same-origin, rate-limited, size-capped client diagnostics sink. Accepts a tiny validated JSON
 * report (render-error or dashboard mount marker). Never authenticates (it may fire on /login or after the
 * session is gone), never reflects input, and returns 204 on success. V1.63.1: the mount marker no longer
 * clears the login trace cookie (it self-expires via Max-Age so a post-mount error can still fall back to
 * it); `clearTraceCookie` is retained but currently always false. Heavy lifting is in `handleClientErrorReport`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY) return new NextResponse(null, { status: 413 });

  let rawBody = "";
  try { rawBody = await req.text(); } catch { return new NextResponse(null, { status: 400 }); }

  const sameOrigin = await isSameOrigin();
  const h = await headers();
  const ipKey = ipKeyFromHeader(h.get("x-forwarded-for"));
  const rateAllowed = (await diagnosticsLimiter.check(`ip:${ipKey}`)).allowed;
  const userAgentFamily = summarizeUserAgent(h.get("user-agent")) ?? undefined;
  const jar = await cookies();
  const cookieTraceId = readValidTraceId(jar.get(TRACE_COOKIE)?.value);

  const result = handleClientErrorReport({ rawBody, sameOrigin, rateAllowed, userAgentFamily, cookieTraceId });

  const res = new NextResponse(null, { status: result.status });
  if (result.clearTraceCookie) res.cookies.delete(TRACE_COOKIE);
  return res;
}
