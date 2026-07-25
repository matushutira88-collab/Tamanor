import { NextResponse, type NextRequest } from "next/server";
import { assignProtectionAction, unassignProtectionAction, updateProtectionActionDueDate, updateProtectionActionPriority, startProtectionAction, blockProtectionAction, completeProtectionAction, skipProtectionAction, reopenProtectionAction } from "@guardora/db";
import { canManageChildSafetyProtectionPlan } from "@guardora/core";
import { resolveProtectionActor, mapProtectionError } from "@/server/child-safety/protection-plan";
import { isSameOrigin } from "@/server/csrf";

/** POST an action operation { op: assign|unassign|due|priority|start|block|complete|skip|reopen }. Same-origin + manage. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ actionId: string }> }): Promise<NextResponse> {
  if (!(await isSameOrigin())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const actor = await resolveProtectionActor();
  if (!actor || !canManageChildSafetyProtectionPlan(actor.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { actionId } = await ctx.params;
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  try {
    switch (String(b.op ?? "")) {
      case "assign": await assignProtectionAction(actor, actionId, String(b.assigneeUserId ?? "")); break;
      case "unassign": await unassignProtectionAction(actor, actionId); break;
      case "due": { const d = b.dueAt ? new Date(String(b.dueAt)) : null; await updateProtectionActionDueDate(actor, actionId, d && !Number.isNaN(d.getTime()) ? d : null); break; }
      case "priority": await updateProtectionActionPriority(actor, actionId, String(b.priority ?? "")); break;
      case "start": await startProtectionAction(actor, actionId); break;
      case "block": await blockProtectionAction(actor, actionId, b.reason ? String(b.reason) : undefined); break;
      case "complete": await completeProtectionAction(actor, actionId, b.note ? String(b.note) : undefined); break;
      case "skip": await skipProtectionAction(actor, actionId); break;
      case "reopen": await reopenProtectionAction(actor, actionId); break;
      default: return NextResponse.json({ ok: false, error: "unknown_op" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) { const { status, code } = mapProtectionError(e); return NextResponse.json({ ok: false, error: code }, { status }); }
}
