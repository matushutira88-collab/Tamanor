import { NextResponse, type NextRequest } from "next/server";
import { handleMonitoringToggle } from "@/server/mobile-accounts";
import { realAccountsDeps } from "@/server/mobile-accounts-deps";

/**
 * M6 — POST /api/mobile/accounts/:accountId/monitoring. Body: `{ enabled: boolean }`.
 *
 * Enabling runs through the canonical ATOMIC monitored-account limit, so a client can
 * never over-allocate by forging `monitoringCanBeEnabled`. Nothing else in the body is
 * read: tenant, role and capacity are all derived server-side.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await ctx.params;
  // A malformed body is an invalid request, never a crash.
  const body = await req.json().catch(() => null);
  const result = await handleMonitoringToggle(
    { authorization: req.headers.get("authorization"), accountId, body },
    realAccountsDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
