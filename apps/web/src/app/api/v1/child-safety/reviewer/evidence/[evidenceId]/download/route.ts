import { NextResponse, type NextRequest } from "next/server";
import { downloadChildSafetyEvidence } from "@guardora/db";
import { resolveEvidenceActor, mapEvidenceError } from "@/server/child-safety/evidence";

/**
 * Evidence download — GET /api/v1/child-safety/reviewer/evidence/[evidenceId]/download.
 * Authorized reviewers only. The service appends a "referenced" custody event + a download audit and
 * returns the stored bytes under a SAFE filename (never a storage key/path). Owner / Admin / Reviewer only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ evidenceId: string }> }): Promise<NextResponse> {
  const actor = await resolveEvidenceActor();
  if (!actor) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { evidenceId } = await ctx.params;
  try {
    const { filename, mimeType, bytes } = await downloadChildSafetyEvidence(actor, evidenceId);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": mimeType,
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(bytes.length),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) { const { status, code } = mapEvidenceError(e); return NextResponse.json({ ok: false, error: code }, { status }); }
}
