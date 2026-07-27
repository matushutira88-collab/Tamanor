import { NextResponse, type NextRequest } from "next/server";
import { integrationInstallationGet } from "@/server/child-safety/integration";

/** GET an installation with its public-key versions (fingerprints only; never a private key). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ installationId: string }> }): Promise<NextResponse> {
  const { installationId } = await ctx.params;
  const r = await integrationInstallationGet(installationId);
  return NextResponse.json(r.body, { status: r.status });
}
