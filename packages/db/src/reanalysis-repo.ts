/**
 * Durable single-item Preview → Confirm re-analysis protocol.
 *
 * Preview stores a bounded, server-built proposal and never mutates ReputationItem or AutoProtectDecision.
 * Confirm never calls a classifier/provider: it locks the item, verifies the stored proposal + source
 * fingerprint, applies exactly that proposal, replaces the stale Auto-Protect decision, writes a privacy-
 * bounded audit event and consumes the preview in one tenant/RLS-scoped transaction.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  ActorKind, Prisma, Priority, PriorityProvenance, RiskLevel, Sentiment,
  type InboxProcessingStatus, type ProcessingTier,
} from "@prisma/client";
import { Permission, can, type Role } from "@guardora/core";
import { withTenantDb, type TenantTx } from "./tenant-db";

export const REANALYSIS_PROPOSAL_VERSION = 1 as const;
export const REANALYSIS_PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_PROPOSAL_BYTES = 64 * 1024;

export interface ReanalysisProposalV1 {
  version: typeof REANALYSIS_PROPOSAL_VERSION;
  processedAt: string;
  classification: {
    riskLevel: string;
    riskConfidence: number;
    riskCategories: string[];
    sentiment: string;
    riskRationale: string | null;
    riskEngine: string | null;
    assessedAt: string;
  };
  intelligence: {
    detectedLanguage: string | null;
    languageConfidence: number | null;
    isMixedLanguage: boolean;
    languageDetectionSource: string | null;
    translationStatus: string;
    translationProvider: string;
    translatedText: string | null;
    translatedToLocale: string | null;
    classificationMode: string;
    aiProvider: string;
    aiProviderStatus: string;
    riskExplanation: unknown;
    aiDiagnostics: unknown | null;
  };
  processing: {
    processingTier: string;
    processingStatus: string;
    processingReason: string | null;
    lastProcessedAt: string;
    classifierVersion: string;
    contentHash: string;
  };
  projection: {
    customerClassificationState: string;
    customerRiskLevel: string;
    customerRiskCategories: string[];
    customerClassificationProjectionVersion: number;
    customerRequiresReanalysis: false;
  };
  priority: { proposed: string };
  autoProtect: {
    matchedCategory: string;
    policyMode: string;
    confidence: number;
    decision: string;
    reason: string | null;
  };
  providerCalls: Array<{
    type: string;
    provider: string;
    status: string;
    latencyMs: number;
    errorCode: string | null;
  }>;
}

export interface ReanalysisSource {
  item: {
    id: string;
    tenantId: string;
    brandId: string;
    platform: string;
    updatedAt: Date;
    assessedAt: Date | null;
    contentHash: string | null;
    status: string;
    priority: string;
    priorityProvenance: string;
    prioritySetByUserId: string | null;
    prioritySetAt: Date | null;
    requiresApproval: boolean;
    isRead: boolean;
    archivedAt: Date | null;
    assignedToUserId: string | null;
    inboxWorkflowStatus: string;
    riskLevel: string;
    riskConfidence: number;
    riskCategories: string[];
    sentiment: string;
    processingStatus: string;
    classifierVersion: string | null;
  };
  content: {
    id: string;
    text: string;
    rating: number | null;
    authorLocale: string | null;
    publishedAt: Date;
  };
  decisions: Array<{
    id: string; action: string; status: string; reviewerUserId: string | null;
    reviewedAt: Date | null; executedAt: Date | null; updatedAt: Date;
  }>;
  queue: null | {
    id: string; category: string; proposedAction: string; queueState: string;
    approvedByUserId: string | null; rejectedByUserId: string | null; updatedAt: Date;
  };
  autoProtect: null | {
    id: string; matchedCategory: string; policyMode: string; confidence: number;
    decision: string; reason: string | null; createdAt: Date;
  };
}

export type CreatePreviewResult =
  | { ok: true; preview: PreviewRecord; reused: boolean }
  | { ok: false; reason: "forbidden" | "not_found" | "expired" | "superseded" | "source_changed" | "proposal_too_large" | "invalid_proposal" };

export type BeginPreviewResult =
  | { ok: true; kind: "existing"; preview: PreviewRecord }
  | { ok: true; kind: "reserved"; previewId: string; source: ReanalysisSource }
  | { ok: false; reason: "forbidden" | "not_found" | "in_progress" | "expired" | "superseded" | "invalid_proposal" };

export type ConfirmPreviewResult =
  | { ok: true; previewId: string; auditId: string; duplicate: boolean }
  | { ok: false; reason: "forbidden" | "not_found" | "wrong_actor" | "expired" | "consumed" | "superseded" | "digest_mismatch" | "source_changed" | "invalid_proposal" };

export interface PreviewRecord {
  id: string;
  reputationItemId: string;
  status: string;
  proposal: ReanalysisProposalV1;
  proposalDigest: string;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedAuditId: string | null;
  createdAt: Date;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Convert a server-built proposal to the exact JSON shape Prisma/PostgreSQL will persist. */
function normalizeProposalJson(value: unknown): ReanalysisProposalV1 | null {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return null;
    const normalized: unknown = JSON.parse(encoded);
    return proposalIsValid(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function digestReanalysisProposal(proposal: ReanalysisProposalV1): string {
  const normalized = normalizeProposalJson(proposal);
  if (!normalized) throw new Error("invalid_reanalysis_proposal");
  return sha256(canonicalJson(normalized));
}

export function reanalysisContentHash(input: ReanalysisSource["content"] & { platform: string }): string {
  return sha256(canonicalJson({
    text: input.text,
    rating: input.rating,
    authorLocale: input.authorLocale,
    platform: input.platform,
    publishedAt: input.publishedAt.toISOString(),
  }));
}

export function reanalysisSourceFingerprint(source: ReanalysisSource): string {
  return sha256(canonicalJson({
    sourceContentHash: reanalysisContentHash({ ...source.content, platform: source.item.platform }),
    itemUpdatedAt: source.item.updatedAt.toISOString(),
    assessedAt: source.item.assessedAt?.toISOString() ?? null,
    classification: {
      riskLevel: source.item.riskLevel,
      riskConfidence: source.item.riskConfidence,
      riskCategories: source.item.riskCategories,
      sentiment: source.item.sentiment,
      processingStatus: source.item.processingStatus,
      classifierVersion: source.item.classifierVersion,
    },
    workflow: {
      status: source.item.status,
      requiresApproval: source.item.requiresApproval,
      isRead: source.item.isRead,
      archivedAt: source.item.archivedAt?.toISOString() ?? null,
      assignedToUserId: source.item.assignedToUserId,
      inboxWorkflowStatus: source.item.inboxWorkflowStatus,
    },
    priority: {
      value: source.item.priority,
      provenance: source.item.priorityProvenance,
      setBy: source.item.prioritySetByUserId,
      setAt: source.item.prioritySetAt?.toISOString() ?? null,
    },
    moderation: source.decisions.map((d) => ({
      id: d.id, action: d.action, status: d.status, reviewerUserId: d.reviewerUserId,
      reviewedAt: d.reviewedAt?.toISOString() ?? null,
      executedAt: d.executedAt?.toISOString() ?? null,
      updatedAt: d.updatedAt.toISOString(),
    })),
    queue: source.queue ? {
      id: source.queue.id, category: source.queue.category, proposedAction: source.queue.proposedAction,
      queueState: source.queue.queueState, approvedByUserId: source.queue.approvedByUserId,
      rejectedByUserId: source.queue.rejectedByUserId, updatedAt: source.queue.updatedAt.toISOString(),
    } : null,
    autoProtect: source.autoProtect ? {
      id: source.autoProtect.id, matchedCategory: source.autoProtect.matchedCategory,
      policyMode: source.autoProtect.policyMode, confidence: source.autoProtect.confidence,
      decision: source.autoProtect.decision, reason: source.autoProtect.reason,
      createdAt: source.autoProtect.createdAt.toISOString(),
    } : null,
  }));
}

const PROCESSING_TIERS = new Set(["rules", "local", "paid"]);
const PROCESSING_STATUSES = new Set([
  "processed_rules", "processed_local", "processed_paid", "cached",
  "basic_limit_reached", "premium_limit_reached", "paid_ai_disabled", "failed",
]);
const CUSTOMER_STATES = new Set(["confirmed", "review_required", "no_issue"]);
const AUTO_PROTECT_MODES = new Set(["none", "monitor", "approval", "auto_hide_shadow", "auto_hide_live_reserved"]);
const AUTO_PROTECT_DECISIONS = new Set(["no_action", "monitor", "requires_approval", "would_auto_hide", "blocked_by_safety"]);

function proposalIsValid(v: unknown): v is ReanalysisProposalV1 {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<ReanalysisProposalV1>;
  const c = p.classification as ReanalysisProposalV1["classification"] | undefined;
  const i = p.intelligence as ReanalysisProposalV1["intelligence"] | undefined;
  const pr = p.processing as ReanalysisProposalV1["processing"] | undefined;
  const projection = p.projection as ReanalysisProposalV1["projection"] | undefined;
  const ap = p.autoProtect as ReanalysisProposalV1["autoProtect"] | undefined;
  const nullableString = (value: unknown): boolean => value === null || typeof value === "string";
  const validDate = (value: unknown): boolean => typeof value === "string" && !Number.isNaN(Date.parse(value));
  const finiteUnit = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  return p.version === 1
    && validDate(p.processedAt)
    && !!c && Object.values(RiskLevel).includes(c.riskLevel as RiskLevel) && finiteUnit(c.riskConfidence)
    && Array.isArray(c.riskCategories) && c.riskCategories.every((x) => typeof x === "string")
    && Object.values(Sentiment).includes(c.sentiment as Sentiment) && nullableString(c.riskRationale) && nullableString(c.riskEngine)
    && validDate(c.assessedAt) && c.assessedAt === p.processedAt
    && !!i && nullableString(i.detectedLanguage) && (i.languageConfidence === null || finiteUnit(i.languageConfidence))
    && typeof i.isMixedLanguage === "boolean" && nullableString(i.languageDetectionSource)
    && typeof i.translationStatus === "string" && typeof i.translationProvider === "string"
    && nullableString(i.translatedText) && nullableString(i.translatedToLocale)
    && typeof i.classificationMode === "string" && typeof i.aiProvider === "string"
    && typeof i.aiProviderStatus === "string"
    && Object.prototype.hasOwnProperty.call(i, "riskExplanation")
    && Object.prototype.hasOwnProperty.call(i, "aiDiagnostics")
    && !!pr && PROCESSING_TIERS.has(pr.processingTier) && PROCESSING_STATUSES.has(pr.processingStatus)
    && nullableString(pr.processingReason) && validDate(pr.lastProcessedAt) && pr.lastProcessedAt === p.processedAt
    && typeof pr.classifierVersion === "string" && pr.classifierVersion.length > 0
    && typeof pr.contentHash === "string" && pr.contentHash.length > 0
    && !!projection && CUSTOMER_STATES.has(projection.customerClassificationState)
    && Object.values(RiskLevel).includes(projection.customerRiskLevel as RiskLevel) && Array.isArray(projection.customerRiskCategories)
    && projection.customerRiskCategories.every((x) => typeof x === "string")
    && Number.isInteger(projection.customerClassificationProjectionVersion)
    && projection.customerClassificationProjectionVersion > 0
    && projection.customerRequiresReanalysis === false
    && !!p.priority && Object.values(Priority).includes(p.priority.proposed as Priority)
    && !!ap && typeof ap.matchedCategory === "string" && ap.matchedCategory.length > 0
    && AUTO_PROTECT_MODES.has(ap.policyMode)
    && finiteUnit(ap.confidence) && AUTO_PROTECT_DECISIONS.has(ap.decision) && nullableString(ap.reason)
    && Array.isArray(p.providerCalls)
    && p.providerCalls.every((call) => !!call && typeof call === "object"
      && typeof call.type === "string" && typeof call.provider === "string"
      && typeof call.status === "string" && Number.isInteger(call.latencyMs) && call.latencyMs >= 0
      && nullableString(call.errorCode));
}

async function loadSourceTx(db: TenantTx, tenantId: string, itemId: string): Promise<ReanalysisSource | null> {
  const item = await db.reputationItem.findFirst({
    where: { id: itemId, tenantId },
    select: {
      id: true, tenantId: true, brandId: true, platform: true, updatedAt: true, assessedAt: true,
      contentHash: true, status: true, priority: true, priorityProvenance: true, prioritySetByUserId: true,
      prioritySetAt: true, requiresApproval: true, isRead: true, archivedAt: true, assignedToUserId: true,
      inboxWorkflowStatus: true, riskLevel: true, riskConfidence: true, riskCategories: true, sentiment: true,
      processingStatus: true, classifierVersion: true,
      contentItem: { select: { id: true, text: true, rating: true, authorLocale: true, publishedAt: true } },
      decisions: {
        orderBy: { id: "asc" },
        select: { id: true, action: true, status: true, reviewerUserId: true, reviewedAt: true, executedAt: true, updatedAt: true },
      },
    },
  });
  if (!item) return null;
  const [queue, autoProtect] = await Promise.all([
    db.actionQueueItem.findFirst({
      where: { itemId, tenantId },
      select: { id: true, category: true, proposedAction: true, queueState: true, approvedByUserId: true, rejectedByUserId: true, updatedAt: true },
    }),
    db.autoProtectDecision.findFirst({
      where: { itemId, tenantId },
      select: { id: true, matchedCategory: true, policyMode: true, confidence: true, decision: true, reason: true, createdAt: true },
    }),
  ]);
  return {
    item: {
      ...item,
      platform: String(item.platform), status: String(item.status), priority: String(item.priority),
      priorityProvenance: String(item.priorityProvenance), inboxWorkflowStatus: String(item.inboxWorkflowStatus),
      riskLevel: String(item.riskLevel), sentiment: String(item.sentiment), processingStatus: String(item.processingStatus),
    },
    content: item.contentItem,
    decisions: item.decisions.map((d) => ({ ...d, action: String(d.action), status: String(d.status) })),
    queue,
    autoProtect,
  };
}

async function lockItemTx(db: TenantTx, tenantId: string, itemId: string): Promise<boolean> {
  const locked = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "reputation_items"
    WHERE "id" = ${itemId} AND "tenantId" = ${tenantId}
    FOR UPDATE
  `);
  return locked.length === 1;
}

async function actorCanReanalyzeTx(db: TenantTx, tenantId: string, actorUserId: string): Promise<boolean> {
  const membership = await db.membership.findFirst({
    where: { tenantId, userId: actorUserId },
    select: { role: true },
  });
  return !!membership && can(membership.role as unknown as Role, Permission.InboxAct);
}

export function getReanalysisSource(tenantId: string, itemId: string): Promise<ReanalysisSource | null> {
  return withTenantDb(tenantId, (db) => loadSourceTx(db, tenantId, itemId));
}

function previewRecord(row: {
  id: string; reputationItemId: string; status: string; proposal: Prisma.JsonValue; proposalDigest: string;
  expiresAt: Date; consumedAt: Date | null; consumedAuditId: string | null; createdAt: Date;
}): PreviewRecord | null {
  if (!proposalIsValid(row.proposal)) return null;
  return { ...row, proposal: row.proposal };
}

export function findReanalysisPreviewByIdempotency(
  tenantId: string, itemId: string, actorUserId: string, idempotencyKey: string,
): Promise<PreviewRecord | null> {
  return withTenantDb(tenantId, async (db) => {
    const row = await db.reputationReanalysisPreview.findFirst({
      where: { tenantId, reputationItemId: itemId, createdByUserId: actorUserId, idempotencyKey },
    });
    return row ? previewRecord(row) : null;
  });
}

export function getReanalysisPreview(
  tenantId: string, itemId: string, actorUserId: string, previewId: string,
): Promise<PreviewRecord | null> {
  return withTenantDb(tenantId, async (db) => {
    const row = await db.reputationReanalysisPreview.findFirst({
      where: { id: previewId, tenantId, reputationItemId: itemId, createdByUserId: actorUserId },
    });
    return row ? previewRecord(row) : null;
  });
}

const PROCESSING_PROPOSAL = { version: 0, state: "processing" } as const;

/**
 * Reserve the one classifier run BEFORE any provider call. The item row lock serializes competing
 * previews; a retry with the same idempotency key either receives the completed preview or an
 * `in_progress` result and can never launch a second classifier/provider run.
 */
export function beginReanalysisPreview(input: {
  tenantId: string;
  itemId: string;
  actorUserId: string;
  idempotencyKey: string;
  now?: Date;
}): Promise<BeginPreviewResult> {
  const now = input.now ?? new Date();
  return withTenantDb(input.tenantId, async (db) => {
    if (!(await actorCanReanalyzeTx(db, input.tenantId, input.actorUserId))) {
      return { ok: false, reason: "forbidden" };
    }
    if (!(await lockItemTx(db, input.tenantId, input.itemId))) {
      return { ok: false, reason: "not_found" };
    }

    const sameRequest = await db.reputationReanalysisPreview.findFirst({
      where: {
        tenantId: input.tenantId,
        reputationItemId: input.itemId,
        createdByUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (sameRequest) {
      if (sameRequest.status === "processing") {
        if (sameRequest.expiresAt.getTime() > now.getTime()) {
          return { ok: false, reason: "in_progress" };
        }
        await db.reputationReanalysisPreview.updateMany({
          where: { id: sameRequest.id, status: "processing" },
          data: { status: "expired" },
        });
        return { ok: false, reason: "expired" };
      }
      if (sameRequest.status === "pending") {
        if (sameRequest.expiresAt.getTime() <= now.getTime()) {
          await db.reputationReanalysisPreview.updateMany({
            where: { id: sameRequest.id, status: "pending" },
            data: { status: "expired" },
          });
          return { ok: false, reason: "expired" };
        }
        const completed = previewRecord(sameRequest);
        return completed
          ? { ok: true, kind: "existing", preview: completed }
          : { ok: false, reason: "invalid_proposal" };
      }
      if (sameRequest.status === "consumed") {
        const completed = previewRecord(sameRequest);
        return completed
          ? { ok: true, kind: "existing", preview: completed }
          : { ok: false, reason: "invalid_proposal" };
      }
      if (sameRequest.status === "expired") return { ok: false, reason: "expired" };
      if (sameRequest.status === "superseded") return { ok: false, reason: "superseded" };
      return { ok: false, reason: "invalid_proposal" };
    }

    const anotherRun = await db.reputationReanalysisPreview.findFirst({
      where: {
        tenantId: input.tenantId,
        reputationItemId: input.itemId,
        status: "processing",
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (anotherRun) return { ok: false, reason: "in_progress" };

    const source = await loadSourceTx(db, input.tenantId, input.itemId);
    if (!source) return { ok: false, reason: "not_found" };
    const sourceContentHash = reanalysisContentHash({ ...source.content, platform: source.item.platform });
    const sourceFingerprint = reanalysisSourceFingerprint(source);
    const placeholderDigest = sha256(canonicalJson(PROCESSING_PROPOSAL));
    const expiresAt = new Date(now.getTime() + REANALYSIS_PREVIEW_TTL_MS);

    const row = await db.reputationReanalysisPreview.create({
      data: {
        id: `rrp_${randomUUID().replace(/-/g, "")}`,
        tenantId: input.tenantId,
        brandId: source.item.brandId,
        reputationItemId: input.itemId,
        createdByUserId: input.actorUserId,
        status: "processing",
        sourceContentHash,
        sourceUpdatedAt: source.item.updatedAt,
        sourceAssessedAt: source.item.assessedAt,
        sourceFingerprint,
        proposal: PROCESSING_PROPOSAL,
        proposalDigest: placeholderDigest,
        idempotencyKey: input.idempotencyKey,
        expiresAt,
      },
      select: { id: true },
    });
    return { ok: true, kind: "reserved", previewId: row.id, source };
  });
}

/** Finish a reserved Preview without re-running the classifier/provider. */
export function completeReanalysisPreview(input: {
  tenantId: string;
  itemId: string;
  actorUserId: string;
  previewId: string;
  proposal: ReanalysisProposalV1;
  now?: Date;
}): Promise<CreatePreviewResult> {
  const now = input.now ?? new Date();
  const proposal = normalizeProposalJson(input.proposal);
  if (!proposal) return Promise.resolve({ ok: false, reason: "invalid_proposal" });
  const encoded = canonicalJson(proposal);
  if (Buffer.byteLength(encoded, "utf8") > MAX_PROPOSAL_BYTES) {
    return Promise.resolve({ ok: false, reason: "proposal_too_large" });
  }
  const proposalDigest = sha256(encoded);

  return withTenantDb(input.tenantId, async (db) => {
    if (!(await actorCanReanalyzeTx(db, input.tenantId, input.actorUserId))) {
      return { ok: false, reason: "forbidden" };
    }
    if (!(await lockItemTx(db, input.tenantId, input.itemId))) {
      return { ok: false, reason: "not_found" };
    }
    const row = await db.reputationReanalysisPreview.findFirst({
      where: {
        id: input.previewId,
        tenantId: input.tenantId,
        reputationItemId: input.itemId,
        createdByUserId: input.actorUserId,
      },
    });
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status === "pending") {
      const existing = previewRecord(row);
      return existing
        ? { ok: true, preview: existing, reused: true }
        : { ok: false, reason: "invalid_proposal" };
    }
    if (row.status === "expired" || row.expiresAt.getTime() <= now.getTime()) {
      await db.reputationReanalysisPreview.updateMany({
        where: { id: row.id, status: "processing" },
        data: { status: "expired" },
      });
      return { ok: false, reason: "expired" };
    }
    if (row.status === "superseded") return { ok: false, reason: "superseded" };
    if (row.status !== "processing") return { ok: false, reason: "invalid_proposal" };

    const current = await loadSourceTx(db, input.tenantId, input.itemId);
    if (!current) return { ok: false, reason: "not_found" };
    const currentContentHash = reanalysisContentHash({ ...current.content, platform: current.item.platform });
    if (currentContentHash !== row.sourceContentHash
      || current.item.updatedAt.getTime() !== row.sourceUpdatedAt.getTime()
      || (current.item.assessedAt?.getTime() ?? null) !== (row.sourceAssessedAt?.getTime() ?? null)
      || reanalysisSourceFingerprint(current) !== row.sourceFingerprint) {
      await db.reputationReanalysisPreview.update({ where: { id: row.id }, data: { status: "superseded" } });
      return { ok: false, reason: "source_changed" };
    }

    await db.reputationReanalysisPreview.updateMany({
      where: {
        tenantId: input.tenantId,
        reputationItemId: input.itemId,
        status: "pending",
        id: { not: row.id },
      },
      data: { status: "superseded" },
    });
    const completed = await db.reputationReanalysisPreview.update({
      where: { id: row.id },
      data: {
        status: "pending",
        proposal: proposal as unknown as Prisma.InputJsonValue,
        proposalDigest,
        expiresAt: new Date(now.getTime() + REANALYSIS_PREVIEW_TTL_MS),
      },
    });
    const record = previewRecord(completed);
    return record
      ? { ok: true, preview: record, reused: false }
      : { ok: false, reason: "invalid_proposal" };
  });
}

/** Best-effort terminalization when the provider/configuration path fails after reservation. */
export function abandonReanalysisPreview(
  tenantId: string,
  itemId: string,
  actorUserId: string,
  previewId: string,
): Promise<void> {
  return withTenantDb(tenantId, async (db) => {
    await db.reputationReanalysisPreview.updateMany({
      where: {
        id: previewId,
        tenantId,
        reputationItemId: itemId,
        createdByUserId: actorUserId,
        status: "processing",
      },
      data: { status: "expired", expiresAt: new Date() },
    });
  });
}

function asRiskLevel(v: string): RiskLevel | null {
  return Object.values(RiskLevel).includes(v as RiskLevel) ? v as RiskLevel : null;
}
function asSentiment(v: string): Sentiment | null {
  return Object.values(Sentiment).includes(v as Sentiment) ? v as Sentiment : null;
}
function asPriority(v: string): Priority | null {
  return Object.values(Priority).includes(v as Priority) ? v as Priority : null;
}
function asProcessingTier(v: string): ProcessingTier | null {
  return ["rules", "local", "paid"].includes(v) ? v as ProcessingTier : null;
}
function asProcessingStatus(v: string): InboxProcessingStatus | null {
  return ["processed_rules", "processed_local", "processed_paid", "cached", "basic_limit_reached", "premium_limit_reached", "paid_ai_disabled", "failed"].includes(v)
    ? v as InboxProcessingStatus : null;
}

export function confirmReanalysisPreview(input: {
  tenantId: string;
  itemId: string;
  actorUserId: string;
  previewId: string;
  now?: Date;
  beforeCommit?: () => Promise<void>;
}): Promise<ConfirmPreviewResult> {
  const now = input.now ?? new Date();
  return withTenantDb(input.tenantId, async (db) => {
    // Permission is re-verified inside the same tenant transaction as the state transition, so a role
    // revoked after page render cannot consume a Preview. Then serialize every confirm for this item.
    if (!(await actorCanReanalyzeTx(db, input.tenantId, input.actorUserId))) {
      return { ok: false, reason: "forbidden" };
    }
    if (!(await lockItemTx(db, input.tenantId, input.itemId))) {
      return { ok: false, reason: "not_found" };
    }

    const row = await db.reputationReanalysisPreview.findFirst({
      where: { id: input.previewId, tenantId: input.tenantId, reputationItemId: input.itemId },
    });
    if (!row) return { ok: false, reason: "not_found" };
    if (row.createdByUserId !== input.actorUserId) return { ok: false, reason: "wrong_actor" };
    if (row.status === "consumed") {
      if (row.consumedAuditId) return { ok: true, previewId: row.id, auditId: row.consumedAuditId, duplicate: true };
      return { ok: false, reason: "consumed" };
    }
    if (row.status === "superseded") return { ok: false, reason: "superseded" };
    if (row.status === "expired" || row.expiresAt.getTime() <= now.getTime()) {
      await db.reputationReanalysisPreview.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "expired" } });
      return { ok: false, reason: "expired" };
    }
    if (row.status !== "pending") return { ok: false, reason: "invalid_proposal" };

    const proposal = row.proposal;
    if (!proposalIsValid(proposal)) return { ok: false, reason: "invalid_proposal" };
    if (digestReanalysisProposal(proposal) !== row.proposalDigest) return { ok: false, reason: "digest_mismatch" };

    const current = await loadSourceTx(db, input.tenantId, input.itemId);
    if (!current) return { ok: false, reason: "not_found" };
    const currentContentHash = reanalysisContentHash({ ...current.content, platform: current.item.platform });
    if (currentContentHash !== row.sourceContentHash
      || current.item.updatedAt.getTime() !== row.sourceUpdatedAt.getTime()
      || (current.item.assessedAt?.getTime() ?? null) !== (row.sourceAssessedAt?.getTime() ?? null)
      || reanalysisSourceFingerprint(current) !== row.sourceFingerprint) {
      return { ok: false, reason: "source_changed" };
    }

    const riskLevel = asRiskLevel(proposal.classification.riskLevel);
    const customerRiskLevel = asRiskLevel(proposal.projection.customerRiskLevel);
    const sentiment = asSentiment(proposal.classification.sentiment);
    const proposedPriority = asPriority(proposal.priority.proposed);
    const processingTier = asProcessingTier(proposal.processing.processingTier);
    const processingStatus = asProcessingStatus(proposal.processing.processingStatus);
    if (!riskLevel || !customerRiskLevel || !sentiment || !proposedPriority || !processingTier || !processingStatus) {
      return { ok: false, reason: "invalid_proposal" };
    }

    const priorityCanChange = current.item.priorityProvenance === PriorityProvenance.system;
    await db.reputationItem.update({
      where: { id: input.itemId },
      data: {
        riskLevel,
        riskConfidence: proposal.classification.riskConfidence,
        riskCategories: proposal.classification.riskCategories,
        sentiment,
        riskRationale: proposal.classification.riskRationale,
        riskEngine: proposal.classification.riskEngine,
        assessedAt: new Date(proposal.classification.assessedAt),
        detectedLanguage: proposal.intelligence.detectedLanguage,
        languageConfidence: proposal.intelligence.languageConfidence,
        isMixedLanguage: proposal.intelligence.isMixedLanguage,
        languageDetectionSource: proposal.intelligence.languageDetectionSource,
        translationStatus: proposal.intelligence.translationStatus,
        translationProvider: proposal.intelligence.translationProvider,
        translatedText: proposal.intelligence.translatedText,
        translatedToLocale: proposal.intelligence.translatedToLocale,
        classificationMode: proposal.intelligence.classificationMode,
        aiProvider: proposal.intelligence.aiProvider,
        aiProviderStatus: proposal.intelligence.aiProviderStatus,
        riskExplanation: proposal.intelligence.riskExplanation === null
          ? Prisma.DbNull : proposal.intelligence.riskExplanation as Prisma.InputJsonValue,
        aiDiagnostics: proposal.intelligence.aiDiagnostics === null
          ? Prisma.DbNull : proposal.intelligence.aiDiagnostics as Prisma.InputJsonValue,
        processingTier,
        processingStatus,
        processingReason: proposal.processing.processingReason,
        lastProcessedAt: new Date(proposal.processing.lastProcessedAt),
        classifierVersion: proposal.processing.classifierVersion,
        contentHash: proposal.processing.contentHash,
        customerClassificationState: proposal.projection.customerClassificationState,
        customerRiskLevel,
        customerRiskCategories: proposal.projection.customerRiskCategories,
        customerClassificationProjectionVersion: proposal.projection.customerClassificationProjectionVersion,
        customerRequiresReanalysis: false,
        ...(priorityCanChange ? {
          priority: proposedPriority,
          priorityProvenance: PriorityProvenance.system,
          prioritySetByUserId: null,
          prioritySetAt: new Date(proposal.processedAt),
        } : {}),
      },
    });

    // Replace, do not execute. No ActionQueueItem, ModerationDecision or PlatformActionExecution is touched.
    await db.autoProtectDecision.deleteMany({ where: { itemId: input.itemId, tenantId: input.tenantId } });
    await db.autoProtectDecision.create({
      data: {
        tenantId: input.tenantId,
        brandId: current.item.brandId,
        itemId: input.itemId,
        matchedCategory: proposal.autoProtect.matchedCategory,
        policyMode: proposal.autoProtect.policyMode,
        confidence: proposal.autoProtect.confidence,
        decision: proposal.autoProtect.decision,
        reason: proposal.autoProtect.reason,
      },
    });

    if (proposal.providerCalls.length > 0) {
      await db.providerCall.createMany({
        data: proposal.providerCalls.map((call) => ({
          type: call.type, provider: call.provider, status: call.status, latencyMs: call.latencyMs,
          errorCode: call.errorCode, itemId: input.itemId, tenantId: input.tenantId, brandId: current.item.brandId,
        })),
      });
    }

    const audit = await db.auditLog.create({
      data: {
        tenantId: input.tenantId,
        brandId: current.item.brandId,
        event: "inbox.item_reanalyzed",
        actorKind: ActorKind.human,
        actorUserId: input.actorUserId,
        targetType: "reputation_item",
        targetId: input.itemId,
        metadata: {
          previewId: row.id,
          proposalDigest: row.proposalDigest,
          classificationState: proposal.projection.customerClassificationState,
          riskLevel: proposal.classification.riskLevel,
          processingStatus: proposal.processing.processingStatus,
          classifierVersion: proposal.processing.classifierVersion,
          priorityRecomputed: priorityCanChange,
        },
      },
    });

    await db.reputationReanalysisPreview.update({
      where: { id: row.id },
      data: { status: "consumed", consumedAt: now, consumedAuditId: audit.id },
    });
    if (input.beforeCommit) await input.beforeCommit();
    return { ok: true, previewId: row.id, auditId: audit.id, duplicate: false };
  });
}
