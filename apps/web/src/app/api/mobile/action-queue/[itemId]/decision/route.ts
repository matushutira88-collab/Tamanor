import { NextResponse, type NextRequest } from "next/server";
import { handleQueueDecision } from "@/server/mobile-queue";
import { realQueueDeps } from "@/server/mobile-queue-deps";

/**
 * M5 — POST /api/mobile/action-queue/[itemId]/decision. INTERNAL Tamanor decisions
 * only: `approve`, `reject`, `resolve`.
 *
 * PROVIDER-WRITE BOUNDARY: no live hide, no retry, no rollback, no provider reply or
 * delete is expressible here — the decision union has no member for them, and the
 * handler never reaches a connector. Approve records the decision and its canonical
 * audit event; any platform execution remains behind Tamanor's existing approval and
 * execution controls on the web/worker side.
 *
 * The write is atomic and conditional, so two operators deciding at once cannot
 * overwrite each other's terminal decision — the loser receives 409 with the
 * canonical current state.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<NextResponse> {
  const { itemId } = await ctx.params;
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await handleQueueDecision(
    { authorization: req.headers.get("authorization"), itemId, body },
    realQueueDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
