import { NextResponse, type NextRequest } from "next/server";
import { getChildSafetyEvidence } from "@guardora/db";
import { resolveEvidenceActor, mapEvidenceError } from "@/server/child-safety/evidence";

/**
 * Evidence detail — GET /api/v1/child-safety/reviewer/evidence/[evidenceId].
 * Returns the evidence metadata + its append-only chain of custody (never a storage key/path). Owner /
 * Administrator / Safety Reviewer only. Used by the console to expand an item's custody chain.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ evidenceId: string }> }): Promise<NextResponse> {
  const actor = await resolveEvidenceActor();
  if (!actor) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { evidenceId } = await ctx.params;
  try { return NextResponse.json({ ok: true, ...(await getChildSafetyEvidence(actor, evidenceId)) }); }
  catch (e) { const { status, code } = mapEvidenceError(e); return NextResponse.json({ ok: false, error: code }, { status }); }
}
