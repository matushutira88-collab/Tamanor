"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import { normalize } from "@guardora/ai";
import { confirmReanalysisPreview, withTenant } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { isSameOrigin } from "@/server/csrf";
import { inboxReanalysisLimiter } from "@/lib/rate-limit";
import { previewItemReanalysis } from "@/server/inbox-reanalysis";

const FEEDBACK_TYPES = [
  "correct_risk", "false_positive", "false_negative", "mark_safe", "mark_risky",
  "wrong_category", "wrong_language", "wrong_sentiment",
] as const;
const MEMORY_TYPES = [
  "watch_phrase", "block_phrase", "allow_phrase", "reduce_risk_pattern",
  "increase_risk_pattern", "competitor_phrase", "crisis_phrase",
] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

function backToItem(itemId: string, notice: string, kind: "ok" | "error" = "ok"): never {
  revalidatePath(`/dashboard/inbox/${itemId}`);
  redirect(`/dashboard/inbox/${itemId}?kind=${kind}&notice=${encodeURIComponent(notice)}`);
}

/** Record human feedback on a classification. Brand-scoped; no platform action. */
export async function submitFeedback(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.InboxAct);

  const itemId = String(formData.get("itemId") ?? "");
  const feedbackType = String(formData.get("feedbackType") ?? "");
  if (!(FEEDBACK_TYPES as readonly string[]).includes(feedbackType)) throw new Error("Unknown feedback type");

  const note = String(formData.get("note") ?? "").trim() || null;

  const item = await withTenant(session.tenantId, async (db) => {
    const item = await db.reputationItem.findFirst({
      where: { id: itemId, tenantId: session.tenantId },
      select: { id: true, brandId: true, riskLevel: true, riskCategories: true },
    });
    if (!item) throw new Error("Item not found");

    await db.brandRiskFeedback.create({
      data: {
        tenantId: session.tenantId,
        brandId: item.brandId,
        itemId: item.id,
        actorId: session.userId,
        feedbackType,
        originalRiskLevel: item.riskLevel as unknown as string,
        originalCategory: item.riskCategories[0] ?? null,
        note,
      },
    });

    await writeAudit({
      session, db,
      event: "feedback.created",
      brandId: item.brandId,
      targetType: "reputation_item",
      targetId: item.id,
      metadata: { feedbackType, originalRiskLevel: item.riskLevel },
    });
    return item;
  });

  // Suggest (do NOT auto-create) a memory rule for false positive/negative.
  const suggest =
    feedbackType === "false_positive" ? "allow_phrase" :
    feedbackType === "false_negative" ? "watch_phrase" : null;
  if (suggest) {
    backToItem(item.id, `Feedback saved for this brand. Suggestion: create a ${suggest.replace("_", " ")}?`);
  }
  backToItem(item.id, "Feedback saved for this brand.");
}

/** Create a brand-scoped memory rule (explicit confirm — never auto-created). */
export async function addMemoryRule(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const itemId = String(formData.get("itemId") ?? "");
  const type = String(formData.get("type") ?? "");
  if (!(MEMORY_TYPES as readonly string[]).includes(type)) throw new Error("Unknown memory rule type");
  const phrase = String(formData.get("phrase") ?? "").trim();
  if (!phrase) throw new Error("Phrase is required");
  const severityRaw = String(formData.get("severity") ?? "medium");
  const severity = (SEVERITIES as readonly string[]).includes(severityRaw) ? severityRaw : "medium";

  const item = await withTenant(session.tenantId, async (db) => {
    const item = await db.reputationItem.findFirst({
      where: { id: itemId, tenantId: session.tenantId },
      select: { id: true, brandId: true, detectedLanguage: true },
    });
    if (!item) throw new Error("Item not found");

    const rule = await db.brandRiskMemoryRule.create({
      data: {
        tenantId: session.tenantId,
        brandId: item.brandId,
        type,
        phrase,
        normalizedPhrase: normalize(phrase),
        language: item.detectedLanguage ?? null,
        severity,
        source: "feedback",
        isActive: true,
        createdBy: session.userId,
      },
    });

    await writeAudit({
      session, db,
      event: "memory_rule.created",
      brandId: item.brandId,
      targetType: "brand_memory_rule",
      targetId: rule.id,
      metadata: { type, severity, source: "feedback" },
    });
    return item;
  });

  backToItem(item.id, `Added to brand memory: "${phrase}" (${type.replace("_", " ")}).`);
}


const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{16,120}$/;

function reanalysisBack(itemId: string, result: string, previewId?: string): never {
  revalidatePath(`/dashboard/inbox/${itemId}`);
  const query = new URLSearchParams({ reanalysis: result });
  if (previewId) query.set("preview", previewId);
  redirect(`/dashboard/inbox/${itemId}?${query.toString()}`);
}

/** One provider/classifier run. The browser supplies only item id + an opaque retry key. */
export async function previewReanalysisAction(itemId: string, formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.InboxAct);
  if (!(await isSameOrigin())) reanalysisBack(itemId, "csrf");
  if (!(await inboxReanalysisLimiter.check(`${session.tenantId}:${session.userId}`)).allowed) {
    reanalysisBack(itemId, "rate_limited");
  }
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  if (!IDEMPOTENCY_RE.test(idempotencyKey)) reanalysisBack(itemId, "invalid_request");

  const result = await previewItemReanalysis({
    tenantId: session.tenantId,
    itemId,
    actorUserId: session.userId,
    idempotencyKey,
  });
  if (!result.ok) reanalysisBack(itemId, result.reason);
  reanalysisBack(itemId, result.preview.status === "consumed" ? "success" : "preview_ready", result.preview.id);
}

/** Apply the exact durable proposal. No classification values and no provider call are accepted here. */
export async function confirmReanalysisAction(itemId: string, formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.InboxAct);
  if (!(await isSameOrigin())) reanalysisBack(itemId, "csrf");
  const previewId = String(formData.get("previewId") ?? "");
  if (!/^rrp_[a-f0-9]{32}$/.test(previewId)) reanalysisBack(itemId, "invalid_request");

  const result = await confirmReanalysisPreview({
    tenantId: session.tenantId,
    itemId,
    actorUserId: session.userId,
    previewId,
  });
  if (!result.ok) reanalysisBack(itemId, result.reason, previewId);
  reanalysisBack(itemId, "success", previewId);
}
