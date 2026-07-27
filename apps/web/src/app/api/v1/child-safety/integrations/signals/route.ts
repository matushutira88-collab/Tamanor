import { NextResponse, type NextRequest } from "next/server";
import { gatewayHandle } from "@/server/child-safety/integration";

/**
 * Child Safety Integration SIGNAL GATEWAY — POST /api/v1/child-safety/integrations/signals.
 * Signature-authenticated (per-installation Ed25519) — NOT a browser session. Accepts only a minimal,
 * content-free structured safety signal. Fail-closed; safe bounded error codes; no tenant/existence leakage.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text().catch(() => "");
  const r = await gatewayHandle(rawBody, {
    signature: req.headers.get("x-cs-signature"),
    keyVersion: req.headers.get("x-cs-key-version"),
    installation: req.headers.get("x-cs-installation"),
  });
  const res = NextResponse.json(r.body, { status: r.status });
  if (r.retryAfter) res.headers.set("retry-after", String(r.retryAfter));
  res.headers.set("cache-control", "no-store");
  return res;
}
