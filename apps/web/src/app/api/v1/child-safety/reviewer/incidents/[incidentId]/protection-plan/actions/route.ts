import { NextResponse, type NextRequest } from "next/server";
import { addProtectionAction } from "@guardora/db";
import { canManageChildSafetyProtectionPlan } from "@guardora/core";
import { resolveProtectionActor, mapProtectionError } from "@/server/child-safety/protection-plan";
import { isSameOrigin } from "@/server/csrf";

/** POST a bounded custom internal action to a plan. Same-origin + manage. Owner / Admin / Reviewer only. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isSameOrigin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const actor = await resolveProtectionActor();
  if (!actor || !canManageChildSafetyProtectionPlan(actor.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  try {
    const dueAt = b.dueAt ? new Date(String(b.dueAt)) : null;
    const r = await addProtectionAction(actor, String(b.planId ?? ""), { title: String(b.title ?? ""), description: b.description ? String(b.description) : undefined, priority: b.priority ? String(b.priority) : undefined, actionType: b.actionType ? String(b.actionType) : undefined, dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) { const { status, code } = mapProtectionError(e); return NextResponse.json({ ok: false, error: code }, { status }); }
}
