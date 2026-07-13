/**
 * V1.40 — safe Meta launch diagnostic. Returns ONLY states (no App Secret, access/refresh/
 * page/verify token, raw Graph response or DB URL). Auth-gated to an admin/owner. Reflects
 * config + runtime safety + per-capability launch-verification states (all pending until a
 * real verification run supplies evidence).
 */
import { getSession } from "@/server/auth";
import { can, Permission } from "@guardora/core";
import { checkRlsRuntime } from "@guardora/db";
import { getMetaLaunchStatus, metaProductionSafety } from "@/lib/meta-launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!can(session.role, Permission.MemberManage)) return Response.json({ error: "permission_denied" }, { status: 403 });

  const launch = getMetaLaunchStatus();
  const safety = metaProductionSafety();
  const rls = await checkRlsRuntime();

  return Response.json(
    {
      ...launch,
      productionSafety: safety,
      rlsRuntime: rls.status, // status string only (no role/credentials)
      note: "States only. No secret, token or connection string is ever returned. Live states are pending until a real provider verification run supplies evidence.",
    },
    { status: 200 },
  );
}
