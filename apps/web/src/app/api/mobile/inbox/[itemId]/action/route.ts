import { NextResponse, type NextRequest } from "next/server";
import { handleInboxAction } from "@/server/mobile-inbox";
import { realInboxDeps } from "@/server/mobile-inbox-deps";

/**
 * M4 — POST /api/mobile/inbox/[itemId]/action. INTERNAL Tamanor actions only:
 * read/unread, archive/unarchive, priority, workflow.
 *
 * Provider write actions (hide, delete, reply, ban) are deliberately unreachable
 * here — they remain behind the approval + execution engine. The handler re-checks
 * `Permission.InboxAct` and the authoritative billing write state on every call;
 * the client's `canWrite` is never consulted.
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

  const result = await handleInboxAction(
    { authorization: req.headers.get("authorization"), itemId, body },
    realInboxDeps(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
