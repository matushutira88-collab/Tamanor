"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import { attemptFacebookHide } from "@guardora/sync";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";

function back(id: string, notice: string): never {
  revalidatePath(`/dashboard/action-queue/${id}`);
  redirect(`/dashboard/action-queue/${id}?kind=ok&notice=${encodeURIComponent(notice)}`);
}

async function loadQueueItem(tenantId: string, id: string) {
  const q = await prisma.actionQueueItem.findFirst({ where: { id, tenantId } });
  if (!q) throw new Error("Queue item not found");
  return q;
}

/** Run the gated hide for a queue item and return a user-facing notice. */
async function runHideForQueueItem(
  session: Awaited<ReturnType<typeof requireSession>>,
  q: Awaited<ReturnType<typeof loadQueueItem>>,
  opts?: { retry?: boolean },
): Promise<string> {
  const item = await prisma.reputationItem.findFirst({
    where: { id: q.itemId, tenantId: session.tenantId },
    select: { riskLevel: true, contentItem: { select: { externalId: true, externalParentId: true, connectedAccount: { select: { id: true, status: true, health: true, grantedPermissions: true, accessToken: true, pageId: true, externalId: true, platform: true } } } } },
  });
  const acct = item?.contentItem.connectedAccount;
  if (!acct) return "Approved. No live action was executed (live execution is disabled).";
  const policy = await prisma.controlPolicy.findFirst({ where: { brandId: q.brandId, category: q.category, isActive: true }, select: { id: true, mode: true } });
  const res = await attemptFacebookHide({
    tenantId: session.tenantId, brandId: q.brandId, itemId: q.itemId, queueItemId: q.id, policyId: policy?.id ?? null,
    connectedAccountId: acct.id, platform: acct.platform as unknown as string,
    externalCommentId: item!.contentItem.externalId, externalPostId: item!.contentItem.externalParentId ?? null,
    matchedCategory: q.category, confidence: q.confidence, riskLevel: item!.riskLevel as unknown as string,
    mode: policy?.mode ?? "approval", trigger: "approval",
    account: { status: acct.status as unknown as string, health: acct.health as unknown as string, grantedPermissions: acct.grantedPermissions, accessToken: acct.accessToken, pageId: acct.pageId, externalId: acct.externalId },
    requestedBy: "user",
  }, { retry: opts?.retry });

  // Idempotent results (a prior identical attempt already exists) get their own copy.
  if (res.idempotent) {
    return res.status === "executed" ? "This action was already performed. No Facebook comment was hidden again."
      : res.status === "dry_run" ? "Dry-run was already prepared. No new execution was created and no Facebook comment was hidden."
      : res.status === "failed" ? "The previous attempt failed. Use Retry to try again — a repeated Approve does not retry."
      : `Still blocked (${res.reason}). No Facebook comment was hidden.`;
  }
  return res.status === "executed" ? "Approved and live hide executed."
    : res.status === "dry_run" ? "Dry-run prepared. No Facebook comment was hidden."
    : res.status === "failed" ? "Approved. Live action failed (not faked)."
    : `Approved. Live action blocked (${res.reason}). No Facebook comment was hidden.`;
}

/**
 * Approve a queued action. This NEVER executes a live platform action unless every
 * env + safety gate passes and it is explicitly confirmed. Idempotent: a repeated
 * Approve never creates a duplicate execution (V1.25B). Never reply/delete/Instagram.
 */
export async function approveQueueItem(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  const id = String(formData.get("id") ?? "");
  const q = await loadQueueItem(session.tenantId, id);

  await prisma.actionQueueItem.update({ where: { id: q.id }, data: { queueState: "approved", approvedByUserId: session.userId } });
  await writeAudit({ session, event: "approval.approved", brandId: q.brandId, targetType: "action_queue_item", targetId: q.id, metadata: { category: q.category, proposedAction: q.proposedAction, executed: false } });

  let execNote = "Approved. No live action was executed (live execution is disabled).";
  if (q.proposedAction === "hide_comment") {
    execNote = await runHideForQueueItem(session, q);
  }
  back(q.id, execNote);
}

/**
 * Explicit Retry for a previously FAILED hide execution. This is the ONLY path
 * that re-attempts a failed action — a repeated Approve does not. Idempotency
 * for dry_run/executed still holds (those never re-run here either).
 */
export async function retryQueueItem(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  const id = String(formData.get("id") ?? "");
  const q = await loadQueueItem(session.tenantId, id);
  if (q.proposedAction !== "hide_comment") { back(q.id, "Nothing to retry."); }
  await writeAudit({ session, event: "approval.retried", brandId: q.brandId, targetType: "action_queue_item", targetId: q.id, metadata: { category: q.category } });
  const execNote = await runHideForQueueItem(session, q, { retry: true });
  back(q.id, execNote);
}

export async function rejectQueueItem(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  const id = String(formData.get("id") ?? "");
  const q = await loadQueueItem(session.tenantId, id);

  await prisma.actionQueueItem.update({ where: { id: q.id }, data: { queueState: "rejected", rejectedByUserId: session.userId } });
  await writeAudit({ session, event: "approval.rejected", brandId: q.brandId, targetType: "action_queue_item", targetId: q.id, metadata: { category: q.category } });
  back(q.id, "Rejected.");
}

async function markFeedback(formData: FormData, feedbackType: "mark_safe" | "mark_risky", notice: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.InboxAct);
  const id = String(formData.get("id") ?? "");
  const q = await loadQueueItem(session.tenantId, id);
  const item = await prisma.reputationItem.findFirst({ where: { id: q.itemId, tenantId: session.tenantId }, select: { id: true, riskLevel: true } });

  await prisma.brandRiskFeedback.create({
    data: { tenantId: session.tenantId, brandId: q.brandId, itemId: q.itemId, actorId: session.userId, feedbackType, originalRiskLevel: (item?.riskLevel as unknown as string) ?? null, originalCategory: q.category },
  });
  await writeAudit({ session, event: "feedback.created", brandId: q.brandId, targetType: "reputation_item", targetId: q.itemId, metadata: { feedbackType, category: q.category } });
  back(q.id, notice);
}

export async function markSafeQueueItem(formData: FormData): Promise<void> {
  return markFeedback(formData, "mark_safe", "Marked as safe for this brand.");
}
export async function markHarmfulQueueItem(formData: FormData): Promise<void> {
  return markFeedback(formData, "mark_risky", "Marked as harmful for this brand.");
}

/** Create an incident from this queue item. */
export async function createIncidentFromQueue(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.InboxAct);
  const id = String(formData.get("id") ?? "");
  const q = await loadQueueItem(session.tenantId, id);
  const item = await prisma.reputationItem.findFirst({ where: { id: q.itemId, tenantId: session.tenantId }, select: { platform: true, riskLevel: true } });

  const inc = await prisma.incident.create({
    data: {
      tenantId: session.tenantId, brandId: q.brandId,
      title: `${q.category.replace(/_/g, " ")} — manual incident`, category: q.category,
      severity: item?.riskLevel === "critical" ? "critical" : "high", status: "open",
      sourcePlatform: (item?.platform as unknown as string) ?? null, relatedItemIds: [q.itemId],
    },
  });
  await writeAudit({ session, event: "incident.created", brandId: q.brandId, targetType: "incident", targetId: inc.id, metadata: { category: q.category, manual: true } });
  back(q.id, "Incident created.");
}
