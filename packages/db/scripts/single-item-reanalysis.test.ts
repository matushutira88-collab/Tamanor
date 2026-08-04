/**
 * Real-PostgreSQL regression for durable single-item Preview → Confirm re-analysis.
 * Requires owner DATABASE_URL + distinct RLS APP_DATABASE_URL against the local test database.
 */
import { Prisma } from "@prisma/client";
import {
  beginReanalysisPreview,
  completeReanalysisPreview,
  confirmReanalysisPreview,
  digestReanalysisProposal,
  getReanalysisPreview,
  setInboxPriority,
  bulkInboxAction,
  systemDb,
  withTenantDb,
  type ReanalysisProposalV1,
} from "../src/index";
import { CUSTOMER_PROJECTION_VERSION } from "@guardora/ai";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "  ✓" : "  ✗"} ${label}${condition ? "" : ` — ${detail}`}`);
  condition ? passed++ : failed++;
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const exactText = "Which pattern would concern your brand most: repeated comments, suspicious profiles or sudden engagement spikes?";
let tenantA = "";
let tenantB = "";
let brandA = "";
let brandB = "";
let actor = "";
let secondAdmin = "";
let viewer = "";
let otherOwner = "";
let itemA = "";
let itemB = "";

function benignProposal(now = new Date(), priority = "low"): ReanalysisProposalV1 {
  return {
    version: 1,
    processedAt: now.toISOString(),
    classification: {
      riskLevel: "none",
      riskConfidence: 0.98,
      riskCategories: ["neutral"],
      sentiment: "neutral",
      riskRationale: "No harmful signal detected by current rules.",
      riskEngine: "risk-rules-v1",
      assessedAt: now.toISOString(),
    },
    intelligence: {
      detectedLanguage: "en",
      languageConfidence: 0.99,
      isMixedLanguage: false,
      languageDetectionSource: "rules",
      translationStatus: "not_needed",
      translationProvider: "none",
      translatedText: null,
      translatedToLocale: null,
      classificationMode: "rules_only",
      aiProvider: "none",
      aiProviderStatus: "skipped",
      riskExplanation: {
        matchedTerms: [],
        riskSignals: [],
        shortReason: "No harmful signal detected by current rules.",
        recommendedAction: "monitor",
      },
      aiDiagnostics: {
        callMode: "value_gated",
        rules: { level: "none", confidence: 0.98, categories: ["neutral"] },
        evidenceGate: { decisions: [] },
        merged: { level: "none", confidence: 0.98, categories: ["neutral"] },
      },
    },
    processing: {
      processingTier: "rules",
      processingStatus: "processed_rules",
      processingReason: null,
      lastProcessedAt: now.toISOString(),
      classifierVersion: "risk-rules-v1",
      contentHash: `current_${suffix}`,
    },
    projection: {
      customerClassificationState: "no_issue",
      customerRiskLevel: "none",
      customerRiskCategories: [],
      customerClassificationProjectionVersion: CUSTOMER_PROJECTION_VERSION,
      customerRequiresReanalysis: false,
    },
    priority: { proposed: priority },
    autoProtect: {
      matchedCategory: "normal_criticism",
      policyMode: "monitor",
      confidence: 0.98,
      decision: "no_action",
      reason: "No confirmed harmful category.",
    },
    providerCalls: [],
  };
}

async function seedItem(input: {
  tenantId: string;
  brandId: string;
  accountId: string;
  external: string;
  provenance?: "system" | "human" | "unknown";
  priority?: "low" | "normal" | "high" | "urgent";
  assignedToUserId?: string | null;
}): Promise<string> {
  const content = await systemDb.contentItem.create({
    data: {
      tenantId: input.tenantId,
      brandId: input.brandId,
      connectedAccountId: input.accountId,
      platform: "facebook_page",
      kind: "comment",
      externalId: input.external,
      text: exactText,
      authorExternalId: `author_${suffix}`,
      authorDisplayName: "Legacy author",
      authorLocale: "en",
      publishedAt: new Date("2026-08-01T10:00:00.000Z"),
    },
  });
  return (await systemDb.reputationItem.create({
    data: {
      tenantId: input.tenantId,
      brandId: input.brandId,
      platform: "facebook_page",
      contentItemId: content.id,
      status: "classified",
      priority: input.priority ?? "urgent",
      priorityProvenance: input.provenance ?? "system",
      prioritySetByUserId: input.provenance === "human" ? actor : null,
      prioritySetAt: input.provenance === "human" ? new Date("2026-07-30T10:00:00.000Z") : null,
      requiresApproval: true,
      isRead: true,
      assignedToUserId: input.assignedToUserId ?? null,
      inboxWorkflowStatus: "action_required",
      processingTier: "paid",
      processingStatus: "processed_paid",
      processingReason: null,
      lastProcessedAt: new Date("2026-01-01T00:00:00.000Z"),
      classifierVersion: "legacy-v0",
      contentHash: `legacy_${suffix}`,
      riskLevel: "critical",
      riskConfidence: 0.91,
      riskCategories: ["profanity"],
      sentiment: "neutral",
      riskRationale: "legacy false positive",
      riskEngine: "legacy",
      assessedAt: new Date("2026-01-01T00:00:00.000Z"),
      detectedLanguage: "en",
      languageConfidence: 0.5,
      languageDetectionSource: "legacy",
      translationStatus: "not_needed",
      translationProvider: "none",
      classificationMode: "ai_assisted",
      aiProvider: "legacy-provider",
      aiProviderStatus: "classified",
      riskExplanation: { legacy: true },
      aiDiagnostics: { legacy: true, rawVerdict: "critical/profanity" },
      customerClassificationState: "review_required",
      customerRiskLevel: "medium",
      customerRiskCategories: [],
      customerClassificationProjectionVersion: CUSTOMER_PROJECTION_VERSION,
      customerRequiresReanalysis: true,
    },
  })).id;
}

async function reserveAndComplete(itemId: string, actorUserId: string, key: string, proposal = benignProposal()) {
  const begun = await beginReanalysisPreview({ tenantId: tenantA, itemId, actorUserId, idempotencyKey: key });
  if (!begun.ok || begun.kind !== "reserved") throw new Error(`reservation failed: ${JSON.stringify(begun)}`);
  const complete = await completeReanalysisPreview({
    tenantId: tenantA,
    itemId,
    actorUserId,
    previewId: begun.previewId,
    proposal,
  });
  if (!complete.ok) throw new Error(`completion failed: ${JSON.stringify(complete)}`);
  return { begun, preview: complete.preview };
}

async function setup(): Promise<void> {
  const [ownerUser, adminUser, viewerUser, otherUser] = await Promise.all([
    systemDb.user.create({ data: { email: `rean-owner-${suffix}@example.test`, name: "Owner" } }),
    systemDb.user.create({ data: { email: `rean-admin-${suffix}@example.test`, name: "Admin" } }),
    systemDb.user.create({ data: { email: `rean-viewer-${suffix}@example.test`, name: "Viewer" } }),
    systemDb.user.create({ data: { email: `rean-other-${suffix}@example.test`, name: "Other" } }),
  ]);
  actor = ownerUser.id;
  secondAdmin = adminUser.id;
  viewer = viewerUser.id;
  otherOwner = otherUser.id;
  const [a, b] = await Promise.all([
    systemDb.tenant.create({ data: { name: `Reanalysis A ${suffix}`, slug: `rean-a-${suffix}` } }),
    systemDb.tenant.create({ data: { name: `Reanalysis B ${suffix}`, slug: `rean-b-${suffix}` } }),
  ]);
  tenantA = a.id;
  tenantB = b.id;
  await Promise.all([
    systemDb.membership.create({ data: { userId: actor, tenantId: tenantA, role: "owner" } }),
    systemDb.membership.create({ data: { userId: secondAdmin, tenantId: tenantA, role: "admin" } }),
    systemDb.membership.create({ data: { userId: viewer, tenantId: tenantA, role: "viewer" } }),
    systemDb.membership.create({ data: { userId: otherOwner, tenantId: tenantB, role: "owner" } }),
  ]);
  const [aBrand, bBrand] = await Promise.all([
    systemDb.brand.create({ data: { tenantId: tenantA, name: `Brand A ${suffix}`, defaultLocale: "en" } }),
    systemDb.brand.create({ data: { tenantId: tenantB, name: `Brand B ${suffix}`, defaultLocale: "en" } }),
  ]);
  brandA = aBrand.id;
  brandB = bBrand.id;
  const [accountA, accountB] = await Promise.all([
    systemDb.connectedAccount.create({
      data: { tenantId: tenantA, brandId: brandA, platform: "facebook_page", status: "active", mode: "read_only", health: "healthy", externalId: `rean-a-${suffix}`, scopes: [], grantedPermissions: [] },
    }),
    systemDb.connectedAccount.create({
      data: { tenantId: tenantB, brandId: brandB, platform: "facebook_page", status: "active", mode: "read_only", health: "healthy", externalId: `rean-b-${suffix}`, scopes: [], grantedPermissions: [] },
    }),
  ]);
  itemA = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: accountA.id, external: `main-${suffix}`, assignedToUserId: actor });
  itemB = await seedItem({ tenantId: tenantB, brandId: brandB, accountId: accountB.id, external: `other-${suffix}` });

  const label = await systemDb.inboxLabel.create({ data: { tenantId: tenantA, name: "Protected", normalizedName: `protected-${suffix}`, createdByUserId: actor } });
  await Promise.all([
    systemDb.inboxItemLabel.create({ data: { tenantId: tenantA, reputationItemId: itemA, labelId: label.id, createdByUserId: actor } }),
    systemDb.inboxNote.create({ data: { tenantId: tenantA, reputationItemId: itemA, authorUserId: actor, body: "Protected note body" } }),
    systemDb.moderationDecision.create({
      data: { tenantId: tenantA, brandId: brandA, reputationItemId: itemA, action: "hide", status: "approved", proposedByKind: "human", proposedByUserId: actor, reviewerUserId: secondAdmin, reviewedAt: new Date(), reason: "Protected human decision" },
    }),
    systemDb.actionQueueItem.create({
      data: { tenantId: tenantA, brandId: brandA, itemId: itemA, category: "profanity", confidence: 0.91, proposedAction: "hide_comment", queueState: "approved", approvedByUserId: secondAdmin },
    }),
    systemDb.autoProtectDecision.create({
      data: { tenantId: tenantA, brandId: brandA, itemId: itemA, matchedCategory: "profanity", policyMode: "autonomous", confidence: 0.91, decision: "would_auto_hide", reason: "stale legacy decision" },
    }),
  ]);
}

async function cleanup(): Promise<void> {
  if (tenantA || tenantB) await systemDb.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB].filter(Boolean) } } });
  if (actor || secondAdmin || viewer || otherOwner) await systemDb.user.deleteMany({ where: { id: { in: [actor, secondAdmin, viewer, otherOwner].filter(Boolean) } } });
}

async function run(): Promise<void> {
  await setup();

  console.log("\n0) migration/schema parity + RLS");
  const provenance = await systemDb.$queryRaw<Array<{ is_nullable: string; column_default: string | null; udt_name: string }>>(Prisma.sql`
    SELECT is_nullable, column_default, udt_name FROM information_schema.columns
    WHERE table_name = 'reputation_items' AND column_name = 'priorityProvenance'
  `);
  check("priorityProvenance is enum, NOT NULL, default unknown", provenance[0]?.is_nullable === "NO" && (provenance[0]?.column_default ?? "").includes("unknown") && provenance[0]?.udt_name === "PriorityProvenance", JSON.stringify(provenance[0]));
  const previewColumns = await systemDb.$queryRaw<Array<{ column_name: string }>>(Prisma.sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'reputation_reanalysis_previews'
  `);
  check("durable preview table has complete column set", ["sourceFingerprint", "proposal", "proposalDigest", "idempotencyKey", "expiresAt", "consumedAuditId"].every((name) => previewColumns.some((row) => row.column_name === name)));
  const rls = await systemDb.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(Prisma.sql`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'reputation_reanalysis_previews'
  `);
  check("preview table has ENABLE + FORCE RLS", rls[0]?.relrowsecurity === true && rls[0]?.relforcerowsecurity === true);
  const policy = await systemDb.$queryRaw<Array<{ policyname: string }>>(Prisma.sql`
    SELECT policyname FROM pg_policies WHERE tablename = 'reputation_reanalysis_previews' AND policyname = 'tenant_isolation'
  `);
  check("tenant isolation policy exists", policy.length === 1);
  check("cross-tenant RLS read is empty", (await getReanalysisPreview(tenantB, itemA, otherOwner, "missing")) === null);
  check("cross-tenant RLS insert is rejected", await rejects(() => withTenantDb(tenantA, (db) => db.reputationReanalysisPreview.create({
    data: { id: `rrp_${"a".repeat(32)}`, tenantId: tenantB, brandId: brandB, reputationItemId: itemB, createdByUserId: actor, status: "pending", sourceUpdatedAt: new Date(), sourceFingerprint: "x", proposal: {}, proposalDigest: "x", idempotencyKey: `cross_${suffix}`, expiresAt: new Date(Date.now() + 60_000) },
  }))));

  console.log("\n1) authorization + Preview immutability/idempotency");
  const forbidden = await beginReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: viewer, idempotencyKey: `viewer_${suffix}` });
  check("viewer without InboxAct cannot Preview", !forbidden.ok && forbidden.reason === "forbidden", JSON.stringify(forbidden));
  const before = await systemDb.reputationItem.findUniqueOrThrow({ where: { id: itemA } });
  const oldAp = await systemDb.autoProtectDecision.findUniqueOrThrow({ where: { itemId: itemA } });
  const begun = await beginReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: actor, idempotencyKey: `main_${suffix}` });
  if (!begun.ok || begun.kind !== "reserved") throw new Error(`main reservation failed: ${JSON.stringify(begun)}`);
  const duplicateInFlight = await beginReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: actor, idempotencyKey: `main_${suffix}` });
  check("duplicate Preview cannot start a second run", !duplicateInFlight.ok && duplicateInFlight.reason === "in_progress", JSON.stringify(duplicateInFlight));
  const competingInFlight = await beginReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: secondAdmin, idempotencyKey: `competing_${suffix}` });
  check("competing Preview is serialized", !competingInFlight.ok && competingInFlight.reason === "in_progress", JSON.stringify(competingInFlight));
  const during = await systemDb.reputationItem.findUniqueOrThrow({ where: { id: itemA } });
  const duringAp = await systemDb.autoProtectDecision.findUniqueOrThrow({ where: { itemId: itemA } });
  check("Preview does not write ReputationItem", before.updatedAt.getTime() === during.updatedAt.getTime() && before.riskLevel === during.riskLevel && before.priority === during.priority);
  check("Preview does not replace AutoProtectDecision", oldAp.id === duringAp.id && oldAp.decision === duringAp.decision);
  check("Preview does not persist ProviderCall rows", (await systemDb.providerCall.count({ where: { tenantId: tenantA, itemId: itemA } })) === 0);
  const completed = await completeReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: actor, previewId: begun.previewId, proposal: benignProposal() });
  if (!completed.ok) throw new Error(`main completion failed: ${JSON.stringify(completed)}`);
  const duplicatePreview = await beginReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: actor, idempotencyKey: `main_${suffix}` });
  check("duplicate completed Preview returns same durable proposal", duplicatePreview.ok && duplicatePreview.kind === "existing" && duplicatePreview.preview.id === completed.preview.id);
  check("wrong tenant cannot read a real Preview", (await getReanalysisPreview(tenantB, itemA, otherOwner, completed.preview.id)) === null);
  const wrongTenantConfirm = await confirmReanalysisPreview({ tenantId: tenantB, itemId: itemA, actorUserId: otherOwner, previewId: completed.preview.id });
  check("wrong tenant cannot Confirm a real Preview", !wrongTenantConfirm.ok && wrongTenantConfirm.reason === "not_found", JSON.stringify(wrongTenantConfirm));

  console.log("\n2) production-shape Confirm");
  const protectedBefore = {
    item: await systemDb.reputationItem.findUniqueOrThrow({ where: { id: itemA } }),
    labels: await systemDb.inboxItemLabel.findMany({ where: { tenantId: tenantA, reputationItemId: itemA } }),
    notes: await systemDb.inboxNote.findMany({ where: { tenantId: tenantA, reputationItemId: itemA } }),
    decisions: await systemDb.moderationDecision.findMany({ where: { tenantId: tenantA, reputationItemId: itemA } }),
    queue: await systemDb.actionQueueItem.findUniqueOrThrow({ where: { itemId: itemA } }),
    platformActions: await systemDb.platformActionExecution.count({ where: { tenantId: tenantA, itemId: itemA } }),
  };
  const wrongActor = await confirmReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: secondAdmin, previewId: completed.preview.id });
  check("another authorized actor cannot consume someone else's Preview", !wrongActor.ok && wrongActor.reason === "wrong_actor", JSON.stringify(wrongActor));
  const confirmed = await confirmReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: actor, previewId: completed.preview.id });
  if (!confirmed.ok) throw new Error(`confirm failed: ${JSON.stringify(confirmed)}`);
  const after = await systemDb.reputationItem.findUniqueOrThrow({ where: { id: itemA } });
  check("raw legacy profanity/critical removed", after.riskLevel === "none" && !after.riskCategories.includes("profanity"), `${after.riskLevel}/${after.riskCategories.join(",")}`);
  check("harmless sentiment/category stored", after.sentiment === "neutral" && after.riskCategories.includes("neutral"));
  check("urgent system priority recalculated", after.priority === "low" && after.priorityProvenance === "system" && after.prioritySetByUserId === null);
  check("current diagnostics and classifier metadata stored", (after.aiDiagnostics as { legacy?: boolean } | null)?.legacy !== true && after.classifierVersion === "risk-rules-v1" && after.processingStatus === "processed_rules" && !!after.lastProcessedAt);
  check("customer projection is no_issue and current", after.customerClassificationState === "no_issue" && after.customerRiskLevel === "none" && after.customerRiskCategories.length === 0 && after.customerClassificationProjectionVersion === CUSTOMER_PROJECTION_VERSION && after.customerRequiresReanalysis === false);
  const newAp = await systemDb.autoProtectDecision.findUniqueOrThrow({ where: { itemId: itemA } });
  check("stale AutoProtectDecision replaced without affirmative action", newAp.id !== oldAp.id && newAp.decision === "no_action" && newAp.matchedCategory !== "profanity");
  check("no moderation/platform action executed", (await systemDb.platformActionExecution.count({ where: { tenantId: tenantA, itemId: itemA } })) === protectedBefore.platformActions);
  const protectedAfter = {
    labels: await systemDb.inboxItemLabel.findMany({ where: { tenantId: tenantA, reputationItemId: itemA } }),
    notes: await systemDb.inboxNote.findMany({ where: { tenantId: tenantA, reputationItemId: itemA } }),
    decisions: await systemDb.moderationDecision.findMany({ where: { tenantId: tenantA, reputationItemId: itemA } }),
    queue: await systemDb.actionQueueItem.findUniqueOrThrow({ where: { itemId: itemA } }),
  };
  check("assignee, workflow, approval and read state preserved", after.assignedToUserId === protectedBefore.item.assignedToUserId && after.inboxWorkflowStatus === protectedBefore.item.inboxWorkflowStatus && after.requiresApproval === protectedBefore.item.requiresApproval && after.isRead === protectedBefore.item.isRead);
  check("labels and notes preserved", protectedAfter.labels.length === protectedBefore.labels.length && protectedAfter.notes.length === protectedBefore.notes.length && protectedAfter.notes[0]?.body === protectedBefore.notes[0]?.body);
  check("human moderation decision and queue preserved", protectedAfter.decisions.length === protectedBefore.decisions.length && protectedAfter.decisions[0]?.status === protectedBefore.decisions[0]?.status && protectedAfter.queue.queueState === protectedBefore.queue.queueState && protectedAfter.queue.approvedByUserId === protectedBefore.queue.approvedByUserId);
  const audit = await systemDb.auditLog.findUniqueOrThrow({ where: { id: confirmed.auditId } });
  const auditJson = JSON.stringify(audit.metadata);
  check("audit is privacy bounded", audit.event === "inbox.item_reanalyzed" && !auditJson.includes(exactText) && !auditJson.includes("Legacy author") && !auditJson.includes("providerCalls") && !auditJson.includes("payload"), auditJson);
  const lostResponse = await confirmReanalysisPreview({ tenantId: tenantA, itemId: itemA, actorUserId: actor, previewId: completed.preview.id });
  check("duplicate Confirm/lost response returns same audit", lostResponse.ok && lostResponse.duplicate && lostResponse.auditId === confirmed.auditId, JSON.stringify(lostResponse));

  console.log("\n3) protected priority provenance");
  const account = await systemDb.connectedAccount.findFirstOrThrow({ where: { tenantId: tenantA } });
  const humanItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `human-${suffix}`, provenance: "system" });
  const manual = await setInboxPriority(tenantA, humanItem, "high", actor);
  check("single manual priority write sets human provenance", manual.ok && (await systemDb.reputationItem.findUniqueOrThrow({ where: { id: humanItem } })).priorityProvenance === "human");
  const humanPreview = await reserveAndComplete(humanItem, actor, `human_${suffix}`);
  await confirmReanalysisPreview({ tenantId: tenantA, itemId: humanItem, actorUserId: actor, previewId: humanPreview.preview.id });
  const humanAfter = await systemDb.reputationItem.findUniqueOrThrow({ where: { id: humanItem } });
  check("re-analysis preserves human priority", humanAfter.priority === "high" && humanAfter.priorityProvenance === "human" && humanAfter.prioritySetByUserId === actor);

  const unknownItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `unknown-${suffix}`, provenance: "unknown", priority: "urgent" });
  const unknownPreview = await reserveAndComplete(unknownItem, actor, `unknown_${suffix}`);
  await confirmReanalysisPreview({ tenantId: tenantA, itemId: unknownItem, actorUserId: actor, previewId: unknownPreview.preview.id });
  const unknownAfter = await systemDb.reputationItem.findUniqueOrThrow({ where: { id: unknownItem } });
  check("re-analysis preserves legacy unknown priority", unknownAfter.priority === "urgent" && unknownAfter.priorityProvenance === "unknown");

  const bulkA = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `bulk-a-${suffix}`, provenance: "system" });
  const bulkB = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `bulk-b-${suffix}`, provenance: "unknown" });
  const bulk = await bulkInboxAction(tenantA, [bulkA, bulkB], "set_priority", actor, { priority: "normal" });
  const bulkRows = await systemDb.reputationItem.findMany({ where: { id: { in: [bulkA, bulkB] } } });
  check("bulk manual priority marks every affected row human", bulk.ok && bulkRows.length === 2 && bulkRows.every((row) => row.priority === "normal" && row.priorityProvenance === "human" && row.prioritySetByUserId === actor && row.prioritySetAt !== null));

  console.log("\n4) expiry, digest, conflict, competition and rollback");
  const expiredItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `expired-${suffix}` });
  const expired = await reserveAndComplete(expiredItem, actor, `expired_${suffix}`);
  await systemDb.reputationReanalysisPreview.update({ where: { id: expired.preview.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expiredResult = await confirmReanalysisPreview({ tenantId: tenantA, itemId: expiredItem, actorUserId: actor, previewId: expired.preview.id });
  check("expired Preview cannot be confirmed", !expiredResult.ok && expiredResult.reason === "expired", JSON.stringify(expiredResult));
  const expiredDuplicate = await beginReanalysisPreview({ tenantId: tenantA, itemId: expiredItem, actorUserId: actor, idempotencyKey: `expired_${suffix}` });
  check("expired idempotency key cannot launch another run", !expiredDuplicate.ok && expiredDuplicate.reason === "expired", JSON.stringify(expiredDuplicate));

  const digestItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `digest-${suffix}` });
  const digestPreview = await reserveAndComplete(digestItem, actor, `digest_${suffix}`);
  const tampered = { ...digestPreview.preview.proposal, priority: { proposed: "urgent" } };
  await systemDb.reputationReanalysisPreview.update({ where: { id: digestPreview.preview.id }, data: { proposal: tampered as unknown as Prisma.InputJsonValue } });
  const digestResult = await confirmReanalysisPreview({ tenantId: tenantA, itemId: digestItem, actorUserId: actor, previewId: digestPreview.preview.id });
  check("digest mismatch is rejected", !digestResult.ok && digestResult.reason === "digest_mismatch", JSON.stringify(digestResult));
  check("proposal digest is deterministic", digestReanalysisProposal(benignProposal(new Date("2026-08-04T00:00:00.000Z"))) === digestReanalysisProposal(benignProposal(new Date("2026-08-04T00:00:00.000Z"))));

  const changedItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `changed-${suffix}` });
  const changedPreview = await reserveAndComplete(changedItem, actor, `changed_${suffix}`);
  await systemDb.reputationItem.update({ where: { id: changedItem }, data: { inboxWorkflowStatus: "in_review" } });
  const changedResult = await confirmReanalysisPreview({ tenantId: tenantA, itemId: changedItem, actorUserId: actor, previewId: changedPreview.preview.id });
  check("item changed after Preview conflicts", !changedResult.ok && changedResult.reason === "source_changed", JSON.stringify(changedResult));

  const liveRaceItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `live-race-${suffix}` });
  const livePreviewResults = await Promise.all([
    beginReanalysisPreview({ tenantId: tenantA, itemId: liveRaceItem, actorUserId: actor, idempotencyKey: `live-race-a_${suffix}` }),
    beginReanalysisPreview({ tenantId: tenantA, itemId: liveRaceItem, actorUserId: secondAdmin, idempotencyKey: `live-race-b_${suffix}` }),
  ]);
  const liveReserved = livePreviewResults.find((result) => result.ok && result.kind === "reserved");
  const liveBlocked = livePreviewResults.find((result) => !result.ok && result.reason === "in_progress");
  check("simultaneous competing Previews launch one run", !!liveReserved && !!liveBlocked, JSON.stringify(livePreviewResults));
  if (!liveReserved || !liveReserved.ok || liveReserved.kind !== "reserved") throw new Error("no live Preview winner");
  const liveWinnerActor = livePreviewResults[0] === liveReserved ? actor : secondAdmin;
  const liveCompleted = await completeReanalysisPreview({
    tenantId: tenantA,
    itemId: liveRaceItem,
    actorUserId: liveWinnerActor,
    previewId: liveReserved.previewId,
    proposal: benignProposal(),
  });
  check("winning simultaneous Preview completes", liveCompleted.ok, JSON.stringify(liveCompleted));

  const raceItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `race-${suffix}` });
  const first = await reserveAndComplete(raceItem, actor, `race-a_${suffix}`);
  const second = await reserveAndComplete(raceItem, secondAdmin, `race-b_${suffix}`);
  const firstRow = await systemDb.reputationReanalysisPreview.findUniqueOrThrow({ where: { id: first.preview.id } });
  check("new completed Preview supersedes older pending Preview", firstRow.status === "superseded");
  const staleConfirm = await confirmReanalysisPreview({ tenantId: tenantA, itemId: raceItem, actorUserId: actor, previewId: first.preview.id });
  check("superseded Preview cannot confirm", !staleConfirm.ok && staleConfirm.reason === "superseded");
  const winner = await confirmReanalysisPreview({ tenantId: tenantA, itemId: raceItem, actorUserId: secondAdmin, previewId: second.preview.id });
  check("winning competing Preview confirms", winner.ok && !winner.duplicate);

  const confirmRaceItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `confirm-race-${suffix}` });
  const confirmRacePreview = await reserveAndComplete(confirmRaceItem, actor, `confirm-race_${suffix}`);
  const confirmRace = await Promise.all([
    confirmReanalysisPreview({ tenantId: tenantA, itemId: confirmRaceItem, actorUserId: actor, previewId: confirmRacePreview.preview.id }),
    confirmReanalysisPreview({ tenantId: tenantA, itemId: confirmRaceItem, actorUserId: actor, previewId: confirmRacePreview.preview.id }),
  ]);
  const confirmAuditIds = confirmRace.flatMap((result) => result.ok ? [result.auditId] : []);
  check(
    "simultaneous Confirms are one atomic consume plus one idempotent retry",
    confirmRace.every((result) => result.ok)
      && confirmRace.filter((result) => result.ok && result.duplicate).length === 1
      && new Set(confirmAuditIds).size === 1
      && (await systemDb.auditLog.count({ where: { tenantId: tenantA, targetId: confirmRaceItem, event: "inbox.item_reanalyzed" } })) === 1,
    JSON.stringify(confirmRace),
  );

  const rollbackItem = await seedItem({ tenantId: tenantA, brandId: brandA, accountId: account.id, external: `rollback-${suffix}` });
  await systemDb.autoProtectDecision.create({ data: { tenantId: tenantA, brandId: brandA, itemId: rollbackItem, matchedCategory: "profanity", policyMode: "autonomous", confidence: 0.9, decision: "would_auto_hide" } });
  const rollbackPreview = await reserveAndComplete(rollbackItem, actor, `rollback_${suffix}`);
  const rollbackBefore = await systemDb.reputationItem.findUniqueOrThrow({ where: { id: rollbackItem } });
  const rollbackApBefore = await systemDb.autoProtectDecision.findUniqueOrThrow({ where: { itemId: rollbackItem } });
  check("forced transaction failure rejects", await rejects(() => confirmReanalysisPreview({ tenantId: tenantA, itemId: rollbackItem, actorUserId: actor, previewId: rollbackPreview.preview.id, beforeCommit: async () => { throw new Error("forced rollback"); } })));
  const rollbackAfter = await systemDb.reputationItem.findUniqueOrThrow({ where: { id: rollbackItem } });
  const rollbackApAfter = await systemDb.autoProtectDecision.findUniqueOrThrow({ where: { itemId: rollbackItem } });
  const rollbackRow = await systemDb.reputationReanalysisPreview.findUniqueOrThrow({ where: { id: rollbackPreview.preview.id } });
  check("transaction rollback restores item, AutoProtect, audit and Preview", rollbackAfter.riskLevel === rollbackBefore.riskLevel && rollbackAfter.priority === rollbackBefore.priority && rollbackApAfter.id === rollbackApBefore.id && rollbackRow.status === "pending" && (await systemDb.auditLog.count({ where: { tenantId: tenantA, targetId: rollbackItem, event: "inbox.item_reanalyzed" } })) === 0);

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — single-item re-analysis DB: ${passed} passed, ${failed} failed`);
  await cleanup();
  await systemDb.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await systemDb.$disconnect();
  process.exit(1);
});
