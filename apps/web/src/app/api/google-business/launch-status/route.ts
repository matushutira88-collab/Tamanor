/**
 * V1.41 — safe Google Business Profile launch diagnostic. Returns ONLY states (no client
 * secret, access/refresh token, authorization code, raw Google response, DB URL or token hash).
 * Auth-gated to an admin/owner. All live states are pending until a real verification run
 * supplies evidence.
 */
import { getSession } from "@/server/auth";
import { can, Permission } from "@guardora/core";
import { checkRlsRuntime } from "@guardora/db";
import { getGoogleLaunchStatus, googleProductionSafety } from "@/lib/google-launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!can(session.role, Permission.MemberManage)) return Response.json({ error: "permission_denied" }, { status: 403 });

  const launch = getGoogleLaunchStatus();
  const safety = googleProductionSafety();
  const rls = await checkRlsRuntime();

  return Response.json(
    {
      ...launch,
      productionSafety: safety,
      rlsRuntime: rls.status,
      note: "States only. No secret, token, authorization code or connection string is ever returned. Live states are pending until a real provider verification run supplies evidence.",
    },
    { status: 200 },
  );
}
