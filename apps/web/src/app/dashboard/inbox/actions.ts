"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ModerationAction,
  Permission,
  ReputationStatus,
  assertCan,
} from "@guardora/core";
import { requireSession } from "@/server/auth";
import {
  applyImmediate,
  createProposal,
  type ActionOutcome,
} from "@/server/proposals";

function backToItem(itemId: string, outcome: ActionOutcome): never {
  revalidatePath(`/dashboard/inbox/${itemId}`);
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/approvals");
  const kind = outcome.unsupported ? "unsupported" : outcome.ok ? "ok" : "error";
  const params = new URLSearchParams({ kind, notice: outcome.message });
  redirect(`/dashboard/inbox/${itemId}?${params.toString()}`);
}

// --- Immediate, Guardora-side actions (audited) ----------------------------

export async function resolveItem(itemId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.InboxAct);
  backToItem(itemId, await applyImmediate(session, itemId, ReputationStatus.Resolved));
}

export async function escalateItem(itemId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.InboxAct);
  backToItem(itemId, await applyImmediate(session, itemId, ReputationStatus.Escalated));
}

export async function ignoreItem(itemId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.InboxAct);
  backToItem(itemId, await applyImmediate(session, itemId, ReputationStatus.Ignored));
}

// --- Proposal-creating actions (require approval before execution) ---------

export async function proposeHide(itemId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalPropose);
  backToItem(itemId, await createProposal(session, itemId, ModerationAction.Hide));
}

export async function proposeDelete(itemId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalPropose);
  backToItem(itemId, await createProposal(session, itemId, ModerationAction.Delete));
}

export async function proposeReply(
  itemId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalPropose);
  const text = String(formData.get("replyText") ?? "").trim();
  if (!text) {
    backToItem(itemId, { ok: false, message: "Reply text is required." });
  }
  backToItem(
    itemId,
    await createProposal(session, itemId, ModerationAction.Reply, { replyText: text }),
  );
}
