import { NextResponse, type NextRequest } from "next/server";
import { processSafetySignalIngestion } from "@/server/child-safety/gateway";

/**
 * CS-C6 — Privacy Gateway ingestion endpoint. POST /api/v1/child-safety/signals.
 * Accepts the canonical, signed, MINIMIZED SafetySignalEnvelope only. All validation, authentication,
 * signature verification, replay/idempotency, rate limiting and persistence live in the gateway
 * service; this route only marshals the request/response. Returns safe stable error codes.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const bodyText = await req.text();
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? null;
  const result = await processSafetySignalIngestion({
    contentType: req.headers.get("content-type"),
    bodyText,
    bearerToken: bearer,
    applicationIdHeader: req.headers.get("x-application-id"),
    idempotencyKey: req.headers.get("idempotency-key"),
  });
  return NextResponse.json(result.body, { status: result.status });
}
