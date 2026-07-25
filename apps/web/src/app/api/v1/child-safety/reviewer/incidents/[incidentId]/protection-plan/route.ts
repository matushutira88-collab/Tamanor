import { NextResponse, type NextRequest } from "next/server";
import { getProtectionPlanForIncident, generateProtectionRecommendation, getProtectionPlanTimeline, createDraftProtectionPlan, activateProtectionPlan, completeProtectionPlan, cancelProtectionPlan, reopenProtectionPlan } from "@guardora/db";
import { canManageChildSafetyProtectionPlan } from "@guardora/core";
import { resolveProtectionActor, mapProtectionError } from "@/server/child-safety/protection-plan";
import { isSameOrigin } from "@/server/csrf";

/**
 * Protection plan for an incident.
 *   GET  → the current (non-terminal) plan + progress, or the deterministic recommendation preview if none.
 *   POST → { op: "create"|"activate"|"complete"|"cancel"|"reopen", ... } (same-origin + manage).
 * Owner / Administrator / Safety Reviewer only. Content-minimized; protected free text is not returned here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }): Promise<NextResponse> {
  const actor = await resolveProtectionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { incidentId } = await ctx.params;
  try {
    const plan = await getProtectionPlanForIncident(actor, incidentId);
    if (plan) return NextResponse.json({ ok: true, plan: plan.plan, actions: plan.actions, progress: plan.progress, timeline: await getProtectionPlanTimeline(actor, plan.plan.id) });
    return NextResponse.json({ ok: true, plan: null, recommendation: await generateProtectionRecommendation(actor, incidentId) });
  } catch (e) { const { status, code } = mapProtectionError(e); return NextResponse.json({ ok: false, error: code }, { status }); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }): Promise<NextResponse> {
  if (!(await isSameOrigin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const actor = await resolveProtectionActor();
  if (!actor || !canManageChildSafetyProtectionPlan(actor.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { incidentId } = await ctx.params;
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  try {
    switch (String(b.op ?? "create")) {
      case "create": return NextResponse.json({ ok: true, ...(await createDraftProtectionPlan(actor, incidentId, { fromRecommendation: !!b.fromRecommendation })) });
      case "activate": return NextResponse.json({ ok: true, ...(await activateProtectionPlan(actor, String(b.planId ?? ""))) });
      case "complete": return NextResponse.json({ ok: true, ...(await completeProtectionPlan(actor, String(b.planId ?? ""), b.closedReason ? String(b.closedReason) : undefined)) });
      case "cancel": return NextResponse.json({ ok: true, ...(await cancelProtectionPlan(actor, String(b.planId ?? ""), b.closedReason ? String(b.closedReason) : undefined)) });
      case "reopen": return NextResponse.json({ ok: true, ...(await reopenProtectionPlan(actor, String(b.planId ?? ""))) });
      default: return NextResponse.json({ ok: false, error: "unknown_op" }, { status: 400 });
    }
  } catch (e) { const { status, code } = mapProtectionError(e); return NextResponse.json({ ok: false, error: code }, { status }); }
}
