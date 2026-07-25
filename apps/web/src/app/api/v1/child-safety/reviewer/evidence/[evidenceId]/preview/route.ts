import { NextResponse, type NextRequest } from "next/server";
import { previewChildSafetyEvidence } from "@guardora/db";
import { resolveEvidenceActor, mapEvidenceError } from "@/server/child-safety/evidence";

/**
 * Evidence preview — GET /api/v1/child-safety/reviewer/evidence/[evidenceId]/preview.
 * Authorized reviewers only. Appends a "reviewed" custody event. Returns previewable file bytes INLINE,
 * text as text/plain, or the external URL as JSON. Never exposes a storage key/path. Owner / Admin / Reviewer.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ evidenceId: string }> }): Promise<NextResponse> {
  const actor = await resolveEvidenceActor();
  if (!actor) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { evidenceId } = await ctx.params;
  try {
    const { mimeType, bytes, text, url } = await previewChildSafetyEvidence(actor, evidenceId);
    if (bytes) return new NextResponse(Buffer.from(bytes), { status: 200, headers: { "content-type": mimeType ?? "application/octet-stream", "content-disposition": "inline", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    if (text != null) return new NextResponse(text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    if (url) return NextResponse.json({ ok: true, url });
    return NextResponse.json({ ok: false, error: "not_previewable" }, { status: 415 });
  } catch (e) { const { status, code } = mapEvidenceError(e); return NextResponse.json({ ok: false, error: code }, { status }); }
}
