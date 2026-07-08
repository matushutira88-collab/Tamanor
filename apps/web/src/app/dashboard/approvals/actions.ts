"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import { requireSession } from "@/server/auth";
import {
  approveProposal,
  rejectProposal,
  executeProposal,
  cancelProposal,
  type ActionOutcome,
} from "@/server/proposals";

function backToProposal(id: string, outcome: ActionOutcome): never {
  revalidatePath(`/dashboard/approvals/${id}`);
  revalidatePath("/dashboard/approvals");
  revalidatePath("/dashboard/inbox");
  const kind = outcome.unsupported ? "unsupported" : outcome.ok ? "ok" : "error";
  const params = new URLSearchParams({ kind, notice: outcome.message });
  redirect(`/dashboard/approvals/${id}?${params.toString()}`);
}

export async function approve(id: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  backToProposal(id, await approveProposal(session, id));
}

export async function reject(id: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  backToProposal(id, await rejectProposal(session, id));
}

export async function execute(id: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalExecute);
  backToProposal(id, await executeProposal(session, id));
}

export async function cancel(id: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalPropose);
  backToProposal(id, await cancelProposal(session, id));
}
