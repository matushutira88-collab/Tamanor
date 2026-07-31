import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";
import { systemDb } from "@guardora/db";
import { runCutoverDryRun, runCutoverApply } from "@/server/platform/provider-credential-cutover-dispatch";

/**
 * OWNER-ONLY provider credential cutover — same-origin POST. All authorization / runtime-readiness / bounds /
 * execution live in the import-safe dispatch. Node runtime (Prisma + node:crypto). No caching. No GET mutation.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" } as const;

async function actor() {
  const session = await getSession();
  if (!session || !session.emailVerified) return null;
  const us = await systemDb.userSession.findUnique({ where: { id: session.sessionId }, select: { createdAt: true } }).catch(() => null);
  return { userId: session.userId, authenticatedAt: us?.createdAt ?? null };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isSameOrigin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
  const a = await actor();
  if (!a) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  const raw = await req.json().catch(() => ({}));
  const body = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const mode = body.mode === "apply" ? "apply" : "dry-run";
  const r = mode === "apply"
    ? await runCutoverApply(a, { confirmation: body.confirmation, acknowledge: body.acknowledge, expectedSha: body.expectedSha })
    : await runCutoverDryRun(a);
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}
