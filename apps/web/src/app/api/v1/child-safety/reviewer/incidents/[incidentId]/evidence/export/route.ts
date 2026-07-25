import { NextResponse, type NextRequest } from "next/server";
import { exportChildSafetyEvidencePackage } from "@guardora/db";
import { canManageChildSafetyEvidence } from "@guardora/core";
import { resolveEvidenceActor, mapEvidenceError } from "@/server/child-safety/evidence";

/**
 * Evidence export — GET /api/v1/child-safety/reviewer/incidents/[incidentId]/evidence/export.
 * Returns a DETERMINISTIC ZIP (metadata + manifest + hashes + custody log + files). Requires evidence
 * MANAGE. Appends an "exported" custody event to each item + an export audit. Owner / Admin / Reviewer only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }): Promise<NextResponse> {
  const actor = await resolveEvidenceActor();
  if (!actor || !canManageChildSafetyEvidence(actor.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { incidentId } = await ctx.params;
  try {
    const { filename, bytes } = await exportChildSafetyEvidencePackage(actor, incidentId);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(bytes.length),
        "cache-control": "no-store",
      },
    });
  } catch (e) { const { status, code } = mapEvidenceError(e); return NextResponse.json({ ok: false, error: code }, { status }); }
}
