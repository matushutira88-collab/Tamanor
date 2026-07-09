"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import { attemptFacebookHide, findPreflightDryRun } from "@guardora/sync";
import { decryptToken } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";

function back(id: string, notice: string, kind: "ok" | "error" = "ok"): never {
  revalidatePath(`/dashboard/action-queue/${id}`);
  redirect(`/dashboard/action-queue/${id}?kind=${kind}&notice=${encodeURIComponent(notice)}`);
}

async function loadQueueItem(tenantId: string, id: string) {
  const q = await prisma.actionQueueItem.findFirst({ where: { id, tenantId } });
  if (!q) throw new Error("Queue item not found");
  return q;
}

/** Run the gated hide for a queue item and return a user-facing notice + kind. */
async function runHideForQueueItem(
  session: Awaited<ReturnType<typeof requireSession>>,
  q: Awaited<ReturnType<typeof loadQueueItem>>,
  opts?: { retry?: boolean; liveAttempt?: boolean },
): Promise<{ note: string; kind: "ok" | "error" }> {
  const item = await prisma.reputationItem.findFirst({
    where: { id: q.itemId, tenantId: session.tenantId },
    select: { riskLevel: true, contentItem: { select: { externalId: true, externalParentId: true, connectedAccount: { select: { id: true, status: true, health: true, grantedPermissions: true, accessToken: true, longLivedToken: true, pageId: true, externalId: true, platform: true, tokenExpiresAt: true, lastError: true, connectionStatus: true, tokenHealth: true } } } } },
  });
  const acct = item?.contentItem.connectedAccount;
  if (!acct) return { note: "Approved. No live action was executed (live execution is disabled).", kind: "ok" };
  const policy = await prisma.controlPolicy.findFirst({ where: { brandId: q.brandId, category: q.category, isActive: true }, select: { id: true, mode: true } });
  // CRITICAL: decrypt the stored Page token before the Graph call. The DB value is
  // tagged/encrypted (e.g. "plain:v1:…"); sending it raw makes Graph reject it as an
  // invalid OAuth token (code 190) → false token_expired / reconnect_required.
  const pageToken = decryptToken(acct.longLivedToken ?? acct.accessToken) ?? null;
  const res = await attemptFacebookHide({
    tenantId: session.tenantId, brandId: q.brandId, itemId: q.itemId, queueItemId: q.id, policyId: policy?.id ?? null,
    connectedAccountId: acct.id, platform: acct.platform as unknown as string,
    externalCommentId: item!.contentItem.externalId, externalPostId: item!.contentItem.externalParentId ?? null,
    matchedCategory: q.category, confidence: q.confidence, riskLevel: item!.riskLevel as unknown as string,
    mode: policy?.mode ?? "approval", trigger: "approval",
    account: { status: acct.status as unknown as string, health: acct.health as unknown as string, grantedPermissions: acct.grantedPermissions, accessToken: pageToken, pageId: acct.pageId, externalId: acct.externalId, tokenExpiresAt: acct.tokenExpiresAt, needsReconnect: acct.connectionStatus === "needs_reconnect" || acct.tokenHealth === "expired" || acct.tokenHealth === "invalid" || acct.tokenHealth === "revoked" || acct.lastError === "token_expired", connectionStatus: acct.connectionStatus, tokenHealth: acct.tokenHealth },
    requestedBy: "user",
  }, { retry: opts?.retry, liveAttempt: opts?.liveAttempt });

  // V1.27F — a completed hide (or an already-hidden / deleted comment) is resolved:
  // move it out of the active approval queue and attribute the approving user. Belt
  // and suspenders alongside the sync-layer resolve, and adds approvedByUserId.
  if (res.status === "executed") {
    await prisma.actionQueueItem.updateMany({ where: { id: q.id, queueState: { notIn: ["rejected"] } }, data: { queueState: "executed", approvedByUserId: session.userId } });
  } else if (res.reason === "comment_deleted_or_unavailable") {
    await prisma.actionQueueItem.updateMany({ where: { id: q.id, queueState: { notIn: ["rejected"] } }, data: { queueState: "no_action" } });
  }

  // --- Explicit LIVE attempt notices (V1.26) ---
  if (opts?.liveAttempt) {
    if (res.status === "executed") {
      return { note: res.idempotent
        ? "This action was already performed. The comment was not hidden again. Return to dry-run mode before further testing."
        : "The comment was hidden from the public on Facebook. The comment author or a Page admin may still see it — that is expected Facebook behavior.", kind: "ok" };
    }
    if (res.reason === "comment_deleted_or_unavailable") return { note: "The comment no longer exists on Facebook. Nothing to hide — the item was resolved.", kind: "ok" };
    if (res.reason === "token_expired") return { note: "Facebook token expired. Reconnect the Facebook Page, then try again.", kind: "error" };
    if (res.status === "failed") return { note: "The hide failed. The comment may still be visible. Use Retry (explicit) to try again.", kind: "error" };
    return { note: `Live hide blocked (${res.reason}). No Facebook comment was hidden.`, kind: "error" };
  }

  // --- Non-live (Approve / dry-run) notices ---
  if (res.idempotent) {
    return { note: res.status === "executed" ? "This action was already performed. No Facebook comment was hidden again."
      : res.status === "dry_run" ? "Dry-run was already prepared. No new execution was created and no Facebook comment was hidden."
      : res.status === "failed" ? "The previous attempt failed. Use Retry to try again — a repeated Approve does not retry."
      : `Still blocked (${res.reason}). No Facebook comment was hidden.`, kind: "ok" };
  }
  return { note: res.status === "executed" ? "Approved and live hide executed."
    : res.status === "dry_run" ? "Dry-run prepared. No Facebook comment was hidden."
    : res.status === "failed" ? "Approved. Live action failed (not faked)."
    : `Approved. Live action blocked (${res.reason}). No Facebook comment was hidden.`, kind: "ok" };
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

  let result: { note: string; kind: "ok" | "error" } = { note: "Approved. No live action was executed (live execution is disabled).", kind: "ok" };
  if (q.proposedAction === "hide_comment") {
    result = await runHideForQueueItem(session, q);
  }
  back(q.id, result.note, result.kind);
}

/**
 * V1.26B — "Approve without hiding". Records the decision as approved but never
 * creates any execution or touches Facebook. Used as the secondary action when the
 * item is live-ready, so the operator can explicitly approve WITHOUT a live hide.
 */
export async function approveWithoutHide(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  const id = String(formData.get("id") ?? "");
  const q = await loadQueueItem(session.tenantId, id);
  await prisma.actionQueueItem.update({ where: { id: q.id }, data: { queueState: "approved", approvedByUserId: session.userId } });
  await writeAudit({ session, event: "approval.approved", brandId: q.brandId, targetType: "action_queue_item", targetId: q.id, metadata: { category: q.category, proposedAction: q.proposedAction, executed: false, hidden: false } });
  back(q.id, "The decision was approved, but the comment was not hidden. Use the “Execute live hide on Facebook” button to hide it.");
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
  const result = await runHideForQueueItem(session, q, { retry: true });
  back(q.id, result.note, result.kind);
}

/**
 * V1.26/V1.26C — Execute the controlled LIVE Facebook hide for a single queue item.
 * Distinct from Approve on purpose. Requires an explicit confirmation phrase +
 * checkbox and all live env gates. If no dry-run preflight exists yet, one is
 * created automatically (no Graph call) so the "dry_run precedes executed"
 * invariant holds — the operator is never forced to flip env back to dry-run.
 * Never reply/delete/Instagram; never autonomous; one item only; token never logged.
 */
export async function executeLiveHide(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  const id = String(formData.get("id") ?? "");
  const q = await loadQueueItem(session.tenantId, id);
  const confirmPhrase = String(formData.get("confirmPhrase") ?? "").trim();
  const understood = formData.get("understood") === "on" || formData.get("understood") === "true";
  const isRetry = formData.get("retry") === "1";

  if (q.proposedAction !== "hide_comment") { back(q.id, "This item is not a hide action. No live action taken.", "error"); }

  // Hard confirmation guard: checkbox + exact phrase, else no Graph call.
  if (!understood || confirmPhrase !== "LIVE HIDE") {
    back(q.id, "Live hide not confirmed. Tick the checkbox and type LIVE HIDE exactly. No Facebook comment was hidden.", "error");
  }

  // Self-preflight: ensure a dry-run record exists first (no Graph call). This keeps
  // the invariant without blocking the live action or requiring an env round-trip.
  const policy = await prisma.controlPolicy.findFirst({ where: { brandId: q.brandId, category: q.category, isActive: true }, select: { id: true } });
  const preflight = await findPreflightDryRun({ tenantId: session.tenantId, queueItemId: q.id, policyId: policy?.id ?? null });
  if (!preflight) {
    await runHideForQueueItem(session, q); // non-live path → records a dry_run, no Graph call
  }

  // Audit BEFORE the action. No tokens/secrets — only classified fields.
  await writeAudit({ session, event: "platform_action.live_requested", brandId: q.brandId, targetType: "action_queue_item", targetId: q.id, metadata: { category: q.category, retry: isRetry, actionType: "hide_comment", trigger: "approval" } });

  const result = await runHideForQueueItem(session, q, { liveAttempt: true, retry: isRetry });
  back(q.id, result.note, result.kind);
}

/**
 * V1.27E — mark a handled item as resolved (archive it out of the active approval
 * queue). Used when the comment was hidden or no longer exists on Facebook.
 */
export async function markHandledQueueItem(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ProposalApprove);
  const id = String(formData.get("id") ?? "");
  const q = await loadQueueItem(session.tenantId, id);
  await prisma.actionQueueItem.update({ where: { id: q.id }, data: { queueState: "no_action" } });
  await writeAudit({ session, event: "approval.resolved", brandId: q.brandId, targetType: "action_queue_item", targetId: q.id, metadata: { category: q.category, resolved: true } });
  back(q.id, "Marked as handled.");
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
