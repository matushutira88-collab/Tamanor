import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";
import { systemDb, listPlatformAdministrators, markPlatformAccess, platformAudit } from "@guardora/db";
import { platformAdminMutation } from "@/server/platform/admin-dispatch";

/** Platform administrator management — GET (list) / POST (add/change_role/deactivate/reactivate). Owner-gated
 *  in the service; same-origin required for mutations. Session actor + recent-auth resolved server-side. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function actor() {
  const session = await getSession();
  if (!session || !session.emailVerified) return null;
  const us = await systemDb.userSession.findUnique({ where: { id: session.sessionId }, select: { createdAt: true } }).catch(() => null);
  return { userId: session.userId, authenticatedAt: us?.createdAt ?? null };
}

export async function GET(): Promise<NextResponse> {
  const a = await actor();
  if (!a) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  try {
    const admins = await listPlatformAdministrators(a.userId);
    await markPlatformAccess(a.userId);
    return NextResponse.json({ ok: true, admins });
  } catch {
    await platformAudit(a.userId, "admin.access_denied", { resultCode: "admin_users.view" }).catch(() => {});
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isSameOrigin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const a = await actor();
  if (!a) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const r = await platformAdminMutation(a, body);
  return NextResponse.json(r.body, { status: r.status });
}
